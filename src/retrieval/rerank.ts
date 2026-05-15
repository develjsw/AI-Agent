import { type Config, child } from "@/shared/index.js";

const log = child({ module: "retrieval.rerank" });

const DEFAULT_MAX_TOKENS = 1024;
// 후보 본문을 LLM에 보낼 때 길이 컷. 청크는 보통 수백~수천 토큰이라 앞부분만으로 관련성 판단 가능
const SNIPPET_LEN = 600;

const RERANK_SYSTEM_PROMPT = `당신은 검색 결과 재정렬 전문가입니다. 사용자 질문과 후보 문서들을 보고 각 후보의 관련성을 0~10 점으로 평가합니다.

평가 원칙:
- 10: 질문에 직접 답할 수 있는 핵심 정보 포함
- 5~9: 부분적으로 관련된 정보 포함 (높을수록 답변에 기여 큼)
- 0~4: 거의 관련 없음

응답은 JSON 객체만, 다른 텍스트 금지:
{"scores": [{"id": "<후보 id>", "score": <0~10 숫자>, "reason": "<한 줄 한국어 근거>"}]}

후보 id는 입력된 그대로 사용하고, 모든 후보를 빠짐없이 채점하세요.`;

export interface RerankCandidate {
  id: string;
  title: string;
  content: string;
}

export interface RerankResult {
  id: string;
  score: number;
  reason: string;
}

export interface RerankOptions {
  model: string;
  maxTokens?: number;
}

interface OpenAIJsonResponse {
  choices: Array<{ message: { content: string | null } }>;
}

function buildUserPrompt(question: string, candidates: RerankCandidate[]): string {
  const items = candidates.map((candidate) => {
    const snippet = candidate.content.slice(0, SNIPPET_LEN);
    return `id: ${candidate.id}\n제목: ${candidate.title}\n본문: ${snippet}`;
  });
  return `질문: ${question}\n\n후보:\n${items.join("\n---\n")}`;
}

// 0~10 클램핑, 문자열 점수도 허용
function normalizeScore(raw: unknown): number {
  let score: number;
  if (typeof raw === "number") score = raw;
  else if (typeof raw === "string") score = Number(raw);
  else throw new Error(`rerank score 타입 오류: ${JSON.stringify(raw)}`);

  if (Number.isNaN(score)) throw new Error(`rerank score 파싱 실패: ${JSON.stringify(raw)}`);
  if (score < 0) return 0;
  if (score > 10) return 10;
  return score;
}

function parseRerankResponse(raw: string, validIds: Set<string>): RerankResult[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("rerank 응답이 비어있음");

  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`rerank 응답 형식 오류: ${trimmed.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const rawScores = obj.scores;
  if (!Array.isArray(rawScores)) {
    throw new Error(`rerank scores 배열 누락: ${trimmed.slice(0, 200)}`);
  }

  const results: RerankResult[] = [];
  for (const entry of rawScores) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : null;
    if (!id || !validIds.has(id)) continue;
    const score = normalizeScore(row.score);
    const reason = typeof row.reason === "string" ? row.reason : "";
    results.push({ id, score, reason });
  }
  return results;
}

export async function rerankWithLlm(
  config: Config,
  question: string,
  candidates: RerankCandidate[],
  options: RerankOptions,
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];

  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RERANK_SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(question, candidates) },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI rerank ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }
  const payload = (await response.json()) as OpenAIJsonResponse;
  const content = payload.choices[0]?.message.content ?? "";

  const validIds = new Set(candidates.map((candidate) => candidate.id));
  const results = parseRerankResponse(content, validIds);
  log.info(
    { candidates: candidates.length, scored: results.length, model: options.model },
    "LLM rerank 완료",
  );
  return results;
}
