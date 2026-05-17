import { type Config, child, loadConfig } from "@/shared/index.js";
import { embedTexts } from "@/ingestion/embed.js";
import { ChromaVectorStore } from "@/retrieval/vector-store.js";
import { type Bm25Index, fuseRrf, loadBm25Index } from "@/retrieval/hybrid.js";
import { type RerankCandidate, rerankWithLlm } from "@/retrieval/rerank.js";

import { type AtlassianClient, createAtlassianClient } from "./mcp/atlassian-client.js";
import { type RouterDecision, type RouterResult, routeQuestion } from "./router.js";
import {
  type JiraIssueSummary,
  getJiraIssue,
  summarizeJiraIssue,
} from "./mcp/tools/jira-issue.js";

const log = child({ module: "agents.qa" });

const COLLECTION_NAME = "documents";
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 1024;
const FETCH_K = 10;
const RERANK_INPUT_K = 10;

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
  mcpSources?: JiraIssueSummary[];
}

export interface AnswerOptions {
  topK?: number;
  model?: string;
  maxTokens?: number;
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

function formatMcpSummary(summary: JiraIssueSummary): string {
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
  mcpSummaries: JiraIssueSummary[],
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

  if (mcpSummaries.length > 0) {
    const blocks = mcpSummaries.map((summary) => {
      const block = `[${cite}] ${formatMcpSummary(summary)}\n출처: ${summary.url}`;
      cite += 1;
      return block;
    });
    sections.push(`# 실시간 상태 (MCP)\n${blocks.join("\n\n")}`);
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

async function generateAnswer(
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

let cachedMcpClient: AtlassianClient | null = null;

async function getMcpClient(): Promise<AtlassianClient> {
  if (cachedMcpClient) return cachedMcpClient;
  cachedMcpClient = await createAtlassianClient();
  return cachedMcpClient;
}

async function retrieveRagChunks(
  question: string,
  config: Config,
  options: { topK: number; model: string },
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
  const topIds = rerankInputIds
    .slice()
    .sort((a, b) => (rerankScoreMap.get(b) ?? 0) - (rerankScoreMap.get(a) ?? 0))
    .slice(0, options.topK);

  const topChunks: MergedChunk[] = [];
  for (const id of topIds) {
    const chunk = merged.get(id);
    if (chunk) topChunks.push(chunk);
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

async function fetchMcpSummary(routing: RouterResult): Promise<JiraIssueSummary | undefined> {
  if (!routing.mcpAction) return undefined;
  const mcp = await getMcpClient();
  const raw = await getJiraIssue(mcp.client, routing.mcpAction.args.key);
  return summarizeJiraIssue(raw);
}

export async function answerQuestion(
  question: string,
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const config = loadConfig();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const model = options.model ?? config.CHAT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const routing = await routeQuestion(config, question, { model });

  const needMcp = !!routing.mcpAction;
  // MCP 단독으로 결정됐지만 키가 없으면 RAG로 폴백. HYBRID + 키 없음도 RAG-only로 자연스럽게 처리됨
  const needRag = routing.decision !== "MCP" || !needMcp;

  const [ragChunks, mcpSummary] = await Promise.all([
    needRag ? retrieveRagChunks(question, config, { topK, model }) : Promise.resolve([]),
    needMcp ? fetchMcpSummary(routing) : Promise.resolve(undefined),
  ]);

  const mcpSummaries = mcpSummary ? [mcpSummary] : [];

  const answer = await generateAnswer(
    config,
    SYSTEM_PROMPT,
    buildUserPrompt(question, ragChunks, mcpSummaries),
    { model, maxTokens },
  );

  const sources: AnswerSource[] = ragChunks.map((chunk, index) => ({
    rank: index + 1,
    title: chunk.title,
    url: chunk.sourceUrl,
    distance: chunk.distance,
    content: chunk.content,
  }));

  return {
    question,
    answer,
    routing: { decision: routing.decision, reason: routing.reason },
    sources,
    ...(mcpSummaries.length > 0 ? { mcpSources: mcpSummaries } : {}),
  };
}
