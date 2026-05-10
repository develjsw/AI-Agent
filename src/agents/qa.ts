import { type Config, child, loadConfig } from "@/shared/index.js";
import { embedTexts } from "@/ingestion/embed.js";
import { ChromaVectorStore, type QueryResult } from "@/retrieval/vector-store.js";

const log = child({ module: "agents.qa" });

const COLLECTION_NAME = "documents";
const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_TOKENS = 1024;

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

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function buildUserPrompt(question: string, results: QueryResult[]): string {
  const contexts = results.map((result, index) => {
    const title = asString(result.metadata.title);
    const url = asString(result.metadata.sourceUrl);
    return `[${index + 1}] ${result.document}\n출처: ${title} (${url})`;
  });
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
  const results = await store.query(questionEmbedding, topK);
  log.info({ topK, retrieved: results.length }, "retrieved chunks");

  const answer = await generateAnswer(config, SYSTEM_PROMPT, buildUserPrompt(question, results), {
    model,
    maxTokens,
  });

  const sources: AnswerSource[] = results.map((result, index) => ({
    rank: index + 1,
    title: asString(result.metadata.title),
    url: asString(result.metadata.sourceUrl),
    distance: result.distance,
    content: result.document,
  }));

  return { question, answer, sources };
}
