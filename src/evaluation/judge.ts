import { child, loadConfig } from "@/shared/index.js";

const log = child({ module: "evaluation.judge" });

const DEFAULT_JUDGE_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_TOKENS = 300;

export interface JudgeResult {
  score: number;
  reasoning: string;
}

export interface JudgeOptions {
  model?: string;
  maxTokens?: number;
}

const FAITHFULNESS_SYSTEM = `당신은 RAG 시스템의 답변 충실도(faithfulness)를 평가하는 채점자입니다.

답변이 제공된 컨텍스트에만 근거하는지 0.0~1.0 점수로 평가합니다.

평가 원칙:
- 답변의 모든 사실 주장이 컨텍스트에서 직접 검증 가능하면 1.0
- 컨텍스트에 없는 정보·외부 지식·추측이 섞이면 비례 감점
- "주어진 자료로는 알 수 없다"처럼 정직하게 한계를 인정한 답변은 1.0 (환각 없음)
- 일부 주장만 컨텍스트와 일치하면 부분 점수

응답은 JSON 객체만, 다른 텍스트 금지:
{"score": <0.0~1.0 숫자>, "reasoning": "<한 줄 한국어 근거>"}`;

const ANSWER_RELEVANCY_SYSTEM = `당신은 RAG 시스템 답변의 적절성(answer relevancy)을 평가하는 채점자입니다.

답변이 질문 의도에 부합하는지 0.0~1.0 점수로 평가합니다.

평가 원칙:
- 질문이 묻는 핵심을 직접 다루면 1.0
- 동문서답·두루뭉술·일부만 답하면 비례 감점
- "정보 부족"으로 답한 경우, 질문 대상을 정확히 인식하고 정직하게 답했으면 1.0, 동문서답이면 감점

응답은 JSON 객체만, 다른 텍스트 금지:
{"score": <0.0~1.0 숫자>, "reasoning": "<한 줄 한국어 근거>"}`;

interface OpenAIJsonResponse {
  choices: Array<{ message: { content: string | null } }>;
}

async function callOpenAIJudge(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Judge OpenAI ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }
  const payload = (await response.json()) as OpenAIJsonResponse;
  return payload.choices[0]?.message.content ?? "";
}

// JSON 파싱 + 점수 클램핑
function parseJudgeResponse(raw: string): JudgeResult {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("judge 응답이 비어있음");

  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`judge 응답 형식 오류: ${trimmed.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const rawScore = obj.score;
  const rawReasoning = obj.reasoning;

  if (typeof rawScore !== "number") {
    throw new Error(`judge score 타입 오류: ${JSON.stringify(rawScore)}`);
  }
  const reasoning = typeof rawReasoning === "string" ? rawReasoning : "";

  // 0~1 범위 클램핑 (LLM이 가끔 0~10 같은 범위 반환)
  let score = rawScore;
  if (score > 1) score = score / 10;
  if (score < 0) score = 0;
  if (score > 1) score = 1;

  return { score, reasoning };
}

async function runJudge(
  systemPrompt: string,
  userPrompt: string,
  options: JudgeOptions,
): Promise<JudgeResult> {
  const config = loadConfig();
  const model = options.model ?? DEFAULT_JUDGE_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  const raw = await callOpenAIJudge(
    config.OPENAI_API_KEY,
    systemPrompt,
    userPrompt,
    model,
    maxTokens,
  );
  return parseJudgeResponse(raw);
}

export async function evaluateFaithfulness(
  question: string,
  answer: string,
  contexts: string[],
  options: JudgeOptions = {},
): Promise<JudgeResult> {
  const numbered = contexts.map((ctx, index) => `[${index + 1}] ${ctx}`).join("\n\n");
  const userPrompt = `질문: ${question}\n\n답변:\n${answer}\n\n컨텍스트:\n${numbered}`;
  log.debug({ contextCount: contexts.length }, "faithfulness 평가");
  return runJudge(FAITHFULNESS_SYSTEM, userPrompt, options);
}

export async function evaluateAnswerRelevancy(
  question: string,
  answer: string,
  options: JudgeOptions = {},
): Promise<JudgeResult> {
  const userPrompt = `질문: ${question}\n\n답변:\n${answer}`;
  log.debug("answer relevancy 평가");
  return runJudge(ANSWER_RELEVANCY_SYSTEM, userPrompt, options);
}