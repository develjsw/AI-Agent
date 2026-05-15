import { type Config, child, loadConfig } from "@/shared/index.js";
import { embedTexts } from "@/ingestion/embed.js";
import { ChromaVectorStore } from "@/retrieval/vector-store.js";
import { type Bm25Index, fuseRrf, loadBm25Index } from "@/retrieval/hybrid.js";
import { type RerankCandidate, rerankWithLlm } from "@/retrieval/rerank.js";

const log = child({ module: "agents.qa" });

const COLLECTION_NAME = "documents";
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 1024;
// vector / BM25 각각 폭넓게 가져온 뒤 RRF로 좁히기
const FETCH_K = 10;
// RRF 융합 후 LLM rerank에 넘길 후보 개수. topK보다 넉넉히 잡아 재정렬 여지 확보
const RERANK_INPUT_K = 10;

const SYSTEM_PROMPT = `당신은 사내 지식 어시스턴트입니다. 주어진 컨텍스트를 바탕으로 질문에 정확하게 답하세요.
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

export interface AnswerResult {
  question: string;
  answer: string;
  sources: AnswerSource[];
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
  // vector에서 잡힌 경우만 실제 거리, BM25만 잡힌 경우 NaN
  distance: number;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function buildUserPrompt(question: string, chunks: MergedChunk[]): string {
  const contexts = chunks.map(
    (chunk, index) =>
      `[${index + 1}] ${chunk.content}\n출처: ${chunk.title} (${chunk.sourceUrl})`,
  );
  return `질문: ${question}\n\n컨텍스트:\n${contexts.join("\n\n")}`;
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

// BM25 인덱스는 한 번 빌드해 모듈 레벨 캐시 (eval 다회 호출 시 오버헤드 제거)
let cachedBm25Index: Bm25Index | null = null;

async function getBm25Index(): Promise<Bm25Index> {
  if (cachedBm25Index) return cachedBm25Index;
  cachedBm25Index = await loadBm25Index();
  return cachedBm25Index;
}

export async function answerQuestion(
  question: string,
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const config = loadConfig();
  const topK = options.topK ?? DEFAULT_TOP_K;
  const model = options.model ?? config.CHAT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

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

  // chunk id 합집합으로 메타 정보 모음
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

  // RRF 점수로 두 ranking 결합 → rerank 후보 풀(topK보다 넓게)
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

  // LLM rerank로 점수화 → 내림차순 정렬, 동점은 RRF 순서 유지
  const rerankResults = await rerankWithLlm(config, question, rerankCandidates, { model });
  const rerankScoreMap = new Map(rerankResults.map((entry) => [entry.id, entry.score]));
  const topIds = rerankInputIds
    .slice()
    .sort((a, b) => (rerankScoreMap.get(b) ?? 0) - (rerankScoreMap.get(a) ?? 0))
    .slice(0, topK);

  const topChunks: MergedChunk[] = [];
  for (const id of topIds) {
    const chunk = merged.get(id);
    if (chunk) topChunks.push(chunk);
  }

  log.info(
    {
      topK,
      retrieved: topChunks.length,
      vectorCount: vectorResults.length,
      bm25Count: bm25Results.length,
      rerankCandidates: rerankCandidates.length,
    },
    "hybrid + rerank retrieved",
  );

  const answer = await generateAnswer(
    config,
    SYSTEM_PROMPT,
    buildUserPrompt(question, topChunks),
    { model, maxTokens },
  );

  const sources: AnswerSource[] = topChunks.map((chunk, index) => ({
    rank: index + 1,
    title: chunk.title,
    url: chunk.sourceUrl,
    distance: chunk.distance,
    content: chunk.content,
  }));

  return { question, answer, sources };
}
