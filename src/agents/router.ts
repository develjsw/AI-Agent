import { type Config, child } from "@/shared/index.js";

const log = child({ module: "agents.router" });

const DEFAULT_MAX_TOKENS = 256;

const ROUTER_SYSTEM_PROMPT = `당신은 사내 지식 어시스턴트의 라우터입니다. 사용자 질문이 어떤 정보 소스로 답해야 하는지 결정합니다.

세 가지 결정:
- "RAG": 종결 티켓의 의사결정 근거, 구현 방식, 댓글 내용 등 정적 컨텍스트로 답변 가능
- "MCP": 외부 도구(Jira 단건 조회, Slack 검색)의 실시간 결과가 핵심
- "HYBRID": 과거 컨텍스트(RAG) + 외부 도구 둘 다 필요

판단 신호:
- 회상 동사 ("어떤 작업이었지", "어떻게 만들었지", "왜 그렇게 결정", "구현 방식", "댓글에 뭐라고", "뭐였지") → RAG. 키가 명시되어도 회상이면 RAG 우선 (이미 종결 티켓 본문이 RAG 인덱스에 있음)
- 시간 부사 ("지금", "현재", "최근", "오늘", "방금") + 상태·메타 → MCP 또는 HYBRID
- 키(예: ITSM-1234) 명시 + 시간 부사 + 상태·메타 → MCP, getJiraIssue
- 키 명시 + 회상 + "현재 상태도" 명시 → HYBRID
- "슬랙", "채팅", "메시지", "DM", "스레드" 등 Slack 맥락 → MCP, searchSlack

MCP 도구 선택:
- getJiraIssue: ITSM-XXX 키 + 현재 상태·메타. 단순 회상이면 사용하지 않음
- searchSlack: Slack 채팅 본문 검색. Slack 검색 문법:
  - 채널 지정: in:#channel_name
  - 사용자 지정: from:@username
  - 키워드는 1~2개 핵심 명사로 좁힘
  - 주의: 채널명에 이미 포함된 키워드는 중복 사용 회피 (예: #tf_스크린_마이그레이션 채널에서 "마이그레이션"은 결과 적음). 채널 컨텍스트만 필요하면 in:#channel만, 또는 다른 핵심 키워드 사용
  - 추상적 주제("관련 논의")는 핵심 명사로 변환 ("회의록", "결정사항", 사람 이름 등)

키도 slack query도 모두 비어 있는 MCP/HYBRID 결정도 그대로 출력하되 호출 측이 RAG로 폴백합니다.

응답은 JSON 객체만, 다른 텍스트 금지:
{"decision": "RAG"|"MCP"|"HYBRID", "reason": "<한 줄 한국어 근거>", "issueKey": "<ITSM-XXX 또는 null>", "slackQuery": "<Slack 검색어 또는 null>"}`;

const KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export type RouterDecision = "RAG" | "MCP" | "HYBRID";

export type McpAction =
  | { tool: "getJiraIssue"; args: { key: string } }
  | { tool: "searchSlack"; args: { query: string } };

export interface RouterResult {
  decision: RouterDecision;
  reason: string;
  mcpAction?: McpAction;
}

export interface RouterOptions {
  model: string;
  maxTokens?: number;
}

interface OpenAIJsonResponse {
  choices: Array<{ message: { content: string | null } }>;
}

interface ParsedRouterPayload {
  decision: RouterDecision;
  reason: string;
  issueKey: string | null;
  slackQuery: string | null;
}

function parseRouterResponse(raw: string): ParsedRouterPayload {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("router 응답이 비어있음");

  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`router 응답 형식 오류: ${trimmed.slice(0, 200)}`);
  }
  const payload = parsed as Record<string, unknown>;

  const decision = payload.decision;
  if (decision !== "RAG" && decision !== "MCP" && decision !== "HYBRID") {
    throw new Error(`router decision 값 오류: ${JSON.stringify(decision)}`);
  }
  const reason = typeof payload.reason === "string" ? payload.reason : "";

  const issueKey =
    typeof payload.issueKey === "string" && KEY_PATTERN.test(payload.issueKey)
      ? payload.issueKey
      : null;
  const slackQueryRaw = typeof payload.slackQuery === "string" ? payload.slackQuery.trim() : "";
  const slackQuery = slackQueryRaw.length > 0 ? slackQueryRaw : null;

  return { decision, reason, issueKey, slackQuery };
}

// 두 도구 중 우선순위: issueKey가 더 구체적이므로 우선. 다중 도구 호출은 follow-up
function pickMcpAction(parsed: ParsedRouterPayload): McpAction | undefined {
  if (parsed.decision !== "MCP" && parsed.decision !== "HYBRID") return undefined;
  if (parsed.issueKey) {
    return { tool: "getJiraIssue", args: { key: parsed.issueKey } };
  }
  if (parsed.slackQuery) {
    return { tool: "searchSlack", args: { query: parsed.slackQuery } };
  }
  return undefined;
}

export async function routeQuestion(
  config: Config,
  question: string,
  options: RouterOptions,
): Promise<RouterResult> {
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
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI router ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
    );
  }
  const payload = (await response.json()) as OpenAIJsonResponse;
  const content = payload.choices[0]?.message.content ?? "";

  const parsed = parseRouterResponse(content);
  const mcpAction = pickMcpAction(parsed);

  log.info(
    {
      question,
      decision: parsed.decision,
      reason: parsed.reason,
      issueKey: parsed.issueKey,
      slackQuery: parsed.slackQuery,
      mcpTool: mcpAction?.tool ?? null,
      model: options.model,
    },
    "라우터 결정",
  );

  return { decision: parsed.decision, reason: parsed.reason, mcpAction };
}
