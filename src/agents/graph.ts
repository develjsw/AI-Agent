import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { type Config, child, loadConfig } from "@/shared/index.js";
import { embedTexts } from "@/ingestion/embed.js";
import { ChromaVectorStore } from "@/retrieval/vector-store.js";
import { type Bm25Index, fuseRrf, loadBm25Index } from "@/retrieval/hybrid.js";
import { type RerankCandidate, rerankWithLlm } from "@/retrieval/rerank.js";

import { type AtlassianClient, createAtlassianClient } from "./mcp/atlassian-client.js";
import { type SlackClient, createSlackClient } from "./mcp/slack-client.js";
import { type RouterDecision, type RouterResult, routeQuestion } from "./router.js";
import {
  type JiraIssueSummary,
  getJiraIssue,
  summarizeJiraIssue,
} from "./mcp/tools/jira-issue.js";
import {
  type SlackSearchSummary,
  searchSlack,
  summarizeSlackSearch,
} from "./mcp/tools/slack-search.js";

const log = child({ module: "agents.graph" });

const COLLECTION_NAME = "documents";
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 1024;
const FETCH_K = 10;
const RERANK_INPUT_K = 10;
// 같은 sourceUrl(티켓 키) 청크가 top-K에 최대 N개. 큰 티켓이 top-K를 독점하는 회귀 방지
const MAX_CHUNKS_PER_SOURCE = 2;

const SYSTEM_PROMPT = `당신은 사내 지식 어시스턴트입니다. 주어진 컨텍스트를 바탕으로 질문에 정확하게 답하세요.
- 컨텍스트는 두 종류일 수 있습니다. "종결된 작업 (RAG)"은 과거 기록이며 "실시간 상태 (MCP)"는 호출 시점의 현재 데이터입니다. 둘이 다를 경우 차이를 명시하세요.
- 컨텍스트에 없는 내용은 추측하지 말고 "주어진 자료로는 알 수 없습니다"라고 답하세요.
- 답변 끝에 사용한 출처 번호를 [1], [2] 형식으로 표시하세요.
- 한국어로 답변하세요.`;

export interface AnswerSource {
  rank: number;
  title: string;
  url: string;
  distance: number;
  content: string;
}

export interface RoutingInfo {
  decision: RouterDecision;
  reason: string;
}

export interface AnswerResult {
  question: string;
  answer: string;
  routing: RoutingInfo;
  sources: AnswerSource[];
  mcpJira?: JiraIssueSummary;
  mcpSlack?: SlackSearchSummary;
}

export interface AnswerOptions {
  topK?: number;
  model?: string;
  maxTokens?: number;
}

interface RuntimeOptions {
  topK: number;
  model: string;
  maxTokens: number;
}

interface GenerateOptions {
  model: string;
  maxTokens: number;
}

interface MergedChunk {
  id: string;
  content: string;
  title: string;
  sourceUrl: string;
  distance: number;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function formatJiraSummary(summary: JiraIssueSummary): string {
  const parts = [
    `${summary.key} — ${summary.summary}`,
    `상태: ${summary.status} (${summary.statusCategory})`,
    `유형: ${summary.issueType}`,
    `담당자: ${summary.assignee ?? "미지정"}`,
    `업데이트: ${summary.updated ?? "n/a"}`,
  ];
  if (summary.description) parts.push(`본문:\n${summary.description}`);
  return parts.join("\n");
}

function buildUserPrompt(
  question: string,
  ragChunks: MergedChunk[],
  jiraSummary: JiraIssueSummary | null,
  slackSummary: SlackSearchSummary | null,
): string {
  const sections: string[] = [];
  let cite = 1;

  if (ragChunks.length > 0) {
    const blocks = ragChunks.map((chunk) => {
      const block = `[${cite}] ${chunk.content}\n출처: ${chunk.title} (${chunk.sourceUrl})`;
      cite += 1;
      return block;
    });
    sections.push(`# 종결된 작업 (RAG)\n${blocks.join("\n\n")}`);
  }

  if (jiraSummary) {
    sections.push(
      `# 실시간 Jira 티켓 (MCP)\n[${cite}] ${formatJiraSummary(jiraSummary)}\n출처: ${jiraSummary.url}`,
    );
    cite += 1;
  }

  if (slackSummary && slackSummary.resultCount > 0) {
    sections.push(
      `# 실시간 Slack 검색 (MCP)\n[${cite}] Slack에서 "${slackSummary.query}" 검색 결과 ${slackSummary.resultCount}건\n${slackSummary.markdown}`,
    );
    cite += 1;
  }

  return `질문: ${question}\n\n${sections.join("\n\n")}`;
}

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string | null } }>;
}

async function generateAnswerOpenAI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: GenerateOptions,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI chat ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }
  const payload = (await response.json()) as OpenAIChatResponse;
  return payload.choices[0]?.message.content ?? "";
}

async function generateAnswerImpl(
  config: Config,
  systemPrompt: string,
  userPrompt: string,
  options: GenerateOptions,
): Promise<string> {
  switch (config.CHAT_PROVIDER) {
    case "openai":
      return generateAnswerOpenAI(config.OPENAI_API_KEY, systemPrompt, userPrompt, options);
    default:
      throw new Error(`unsupported chat provider: ${config.CHAT_PROVIDER}`);
  }
}

let cachedBm25Index: Bm25Index | null = null;

async function getBm25Index(): Promise<Bm25Index> {
  if (cachedBm25Index) return cachedBm25Index;
  cachedBm25Index = await loadBm25Index();
  return cachedBm25Index;
}

let cachedAtlassianClient: AtlassianClient | null = null;
let cachedSlackClient: SlackClient | null = null;

async function getAtlassianClient(): Promise<AtlassianClient> {
  if (cachedAtlassianClient) return cachedAtlassianClient;
  cachedAtlassianClient = await createAtlassianClient();
  return cachedAtlassianClient;
}

async function getSlackClient(config: Config): Promise<SlackClient> {
  if (cachedSlackClient) return cachedSlackClient;
  cachedSlackClient = await createSlackClient(config);
  return cachedSlackClient;
}

async function retrieveRagChunks(
  question: string,
  config: Config,
  options: RuntimeOptions,
): Promise<MergedChunk[]> {
  const [questionEmbedding] = await embedTexts([question]);
  if (!questionEmbedding) throw new Error("failed to embed question");

  const store = new ChromaVectorStore({
    url: config.CHROMA_URL,
    collectionName: COLLECTION_NAME,
  });
  await store.init();

  const [vectorResults, bm25Index] = await Promise.all([
    store.query(questionEmbedding, FETCH_K),
    getBm25Index(),
  ]);
  const bm25Results = bm25Index.search(question, FETCH_K);

  const merged = new Map<string, MergedChunk>();
  for (const result of vectorResults) {
    merged.set(result.id, {
      id: result.id,
      content: result.document,
      title: asString(result.metadata.title),
      sourceUrl: asString(result.metadata.sourceUrl),
      distance: result.distance,
    });
  }
  for (const result of bm25Results) {
    if (merged.has(result.id)) continue;
    merged.set(result.id, {
      id: result.id,
      content: result.content,
      title: asString(result.metadata.title),
      sourceUrl: asString(result.metadata.sourceUrl),
      distance: Number.NaN,
    });
  }

  const fusedScores = fuseRrf([
    vectorResults.map((result, i) => ({ id: result.id, rank: i + 1 })),
    bm25Results.map((result, i) => ({ id: result.id, rank: i + 1 })),
  ]);
  const rerankInputIds = [...fusedScores.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, RERANK_INPUT_K)
    .map(([id]) => id);

  const rerankCandidates: RerankCandidate[] = [];
  for (const id of rerankInputIds) {
    const chunk = merged.get(id);
    if (chunk) {
      rerankCandidates.push({ id: chunk.id, title: chunk.title, content: chunk.content });
    }
  }

  const rerankResults = await rerankWithLlm(config, question, rerankCandidates, {
    model: options.model,
  });
  const rerankScoreMap = new Map(rerankResults.map((entry) => [entry.id, entry.score]));
  const sortedIds = rerankInputIds
    .slice()
    .sort((a, b) => (rerankScoreMap.get(b) ?? 0) - (rerankScoreMap.get(a) ?? 0));

  // 다양성 필터: 같은 sourceUrl 청크는 MAX_CHUNKS_PER_SOURCE 까지만.
  // 1차에서 topK 미달이면 한도 초과로 보류된 청크로 채움 (rerank 점수 순 유지)
  const topChunks: MergedChunk[] = [];
  const overflowChunks: MergedChunk[] = [];
  const sourceCounts = new Map<string, number>();
  for (const id of sortedIds) {
    if (topChunks.length >= options.topK) break;
    const chunk = merged.get(id);
    if (!chunk) continue;
    const used = sourceCounts.get(chunk.sourceUrl) ?? 0;
    if (used >= MAX_CHUNKS_PER_SOURCE) {
      overflowChunks.push(chunk);
      continue;
    }
    topChunks.push(chunk);
    sourceCounts.set(chunk.sourceUrl, used + 1);
  }
  for (const chunk of overflowChunks) {
    if (topChunks.length >= options.topK) break;
    topChunks.push(chunk);
  }

  log.info(
    {
      topK: options.topK,
      retrieved: topChunks.length,
      vectorCount: vectorResults.length,
      bm25Count: bm25Results.length,
      rerankCandidates: rerankCandidates.length,
    },
    "hybrid + rerank retrieved",
  );

  return topChunks;
}

// ──────────────────────────────────────────────────────────
// LangGraph StateGraph 정의
// ──────────────────────────────────────────────────────────

const StateAnnotation = Annotation.Root({
  question: Annotation<string>(),
  options: Annotation<RuntimeOptions>(),
  routing: Annotation<RouterResult | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  ragChunks: Annotation<MergedChunk[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  mcpJira: Annotation<JiraIssueSummary | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  mcpSlack: Annotation<SlackSearchSummary | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  answer: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => "",
  }),
});

type GraphState = typeof StateAnnotation.State;
type GraphUpdate = Partial<typeof StateAnnotation.Update>;

const NODE = {
  route: "route",
  retrieveRag: "retrieve_rag",
  fetchJira: "fetch_mcp_jira",
  fetchSlack: "fetch_mcp_slack",
  generate: "generate_answer",
} as const;

async function routeNode(state: GraphState): Promise<GraphUpdate> {
  const config = loadConfig();
  const routing = await routeQuestion(config, state.question, { model: state.options.model });
  return { routing };
}

async function retrieveRagNode(state: GraphState): Promise<GraphUpdate> {
  const config = loadConfig();
  const ragChunks = await retrieveRagChunks(state.question, config, state.options);
  return { ragChunks };
}

async function fetchJiraNode(state: GraphState): Promise<GraphUpdate> {
  const action = state.routing?.mcpAction;
  if (!action || action.tool !== "getJiraIssue") return {};
  const atlassian = await getAtlassianClient();
  const raw = await getJiraIssue(atlassian.client, action.args.key);
  return { mcpJira: summarizeJiraIssue(raw) };
}

async function fetchSlackNode(state: GraphState): Promise<GraphUpdate> {
  const action = state.routing?.mcpAction;
  if (!action || action.tool !== "searchSlack") return {};
  const config = loadConfig();
  const slack = await getSlackClient(config);
  const raw = await searchSlack(slack.client, action.args.query);
  return { mcpSlack: summarizeSlackSearch(raw) };
}

async function generateAnswerNode(state: GraphState): Promise<GraphUpdate> {
  const config = loadConfig();
  const userPrompt = buildUserPrompt(
    state.question,
    state.ragChunks,
    state.mcpJira,
    state.mcpSlack,
  );
  const answer = await generateAnswerImpl(config, SYSTEM_PROMPT, userPrompt, {
    model: state.options.model,
    maxTokens: state.options.maxTokens,
  });
  return { answer };
}

// route 결정에 따라 다음에 실행할 노드들을 배열로 반환 (병렬 fan-out)
function routeDispatch(state: GraphState): string[] {
  const routing = state.routing;
  if (!routing) return [END];

  const needMcp = !!routing.mcpAction;
  // MCP 단독 결정이지만 도구 인자가 비어 mcpAction이 없으면 RAG로 폴백. HYBRID + 인자 없음도 동일
  const needRag = routing.decision !== "MCP" || !needMcp;

  const targets: string[] = [];
  if (needRag) targets.push(NODE.retrieveRag);
  if (needMcp && routing.mcpAction?.tool === "getJiraIssue") targets.push(NODE.fetchJira);
  if (needMcp && routing.mcpAction?.tool === "searchSlack") targets.push(NODE.fetchSlack);

  // 안전망: 위 조건 어디에도 안 잡히면 RAG로 폴백
  if (targets.length === 0) targets.push(NODE.retrieveRag);
  return targets;
}

const compiledGraph = new StateGraph(StateAnnotation)
  .addNode(NODE.route, routeNode)
  .addNode(NODE.retrieveRag, retrieveRagNode)
  .addNode(NODE.fetchJira, fetchJiraNode)
  .addNode(NODE.fetchSlack, fetchSlackNode)
  .addNode(NODE.generate, generateAnswerNode)
  .addEdge(START, NODE.route)
  .addConditionalEdges(NODE.route, routeDispatch, [
    NODE.retrieveRag,
    NODE.fetchJira,
    NODE.fetchSlack,
  ])
  .addEdge(NODE.retrieveRag, NODE.generate)
  .addEdge(NODE.fetchJira, NODE.generate)
  .addEdge(NODE.fetchSlack, NODE.generate)
  .addEdge(NODE.generate, END)
  .compile();

export async function answerQuestion(
  question: string,
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const config = loadConfig();
  const runtimeOptions: RuntimeOptions = {
    topK: options.topK ?? DEFAULT_TOP_K,
    model: options.model ?? config.CHAT_MODEL,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  const finalState = await compiledGraph.invoke({
    question,
    options: runtimeOptions,
  });

  const routing = finalState.routing;
  if (!routing) throw new Error("graph completed without routing decision");

  const sources: AnswerSource[] = finalState.ragChunks.map((chunk, index) => ({
    rank: index + 1,
    title: chunk.title,
    url: chunk.sourceUrl,
    distance: chunk.distance,
    content: chunk.content,
  }));

  const result: AnswerResult = {
    question,
    answer: finalState.answer,
    routing: { decision: routing.decision, reason: routing.reason },
    sources,
  };
  if (finalState.mcpJira) result.mcpJira = finalState.mcpJira;
  if (finalState.mcpSlack) result.mcpSlack = finalState.mcpSlack;
  return result;
}
