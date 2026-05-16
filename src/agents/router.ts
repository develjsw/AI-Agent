import { type Config, child } from "@/shared/index.js";

const log = child({ module: "agents.router" });

const DEFAULT_MAX_TOKENS = 256;

const ROUTER_SYSTEM_PROMPT = `당신은 사내 지식 어시스턴트의 라우터입니다. 사용자 질문이 어떤 정보 소스로 답해야 하는지 결정합니다.

세 가지 결정:
- "RAG": 종결 티켓의 의사결정 근거, 구현 방식, 댓글 내용 등 정적 컨텍스트로 답변 가능
- "MCP": "지금/현재" 상태나 특정 티켓의 최신 메타데이터(상태, 담당자, 진행도)가 핵심
- "HYBRID": 과거 컨텍스트(RAG) + 현재 상태(MCP) 둘 다 필요

판단 신호:
- "지금", "현재", "최근", "오늘", "방금" 같은 시간 부사 → MCP 또는 HYBRID
- "어떻게 만들었지", "왜 그렇게 결정", "구현 방식", "댓글에 뭐라고" → RAG
- 키(예: ITSM-1234) 명시 + 상태 문의 → MCP
- 키 명시 + 구현 회상 + 후속 진행 → HYBRID

현재 지원되는 MCP 도구는 getJiraIssue(단일 키 조회)뿐입니다. 키가 명시되지 않은 MCP/HYBRID라도 그대로 결정하되 issueKey는 null로 두세요(호출 측이 RAG로 폴백).

응답은 JSON 객체만, 다른 텍스트 금지:
{"decision": "RAG"|"MCP"|"HYBRID", "reason": "<한 줄 한국어 근거>", "issueKey": "<ITSM-XXX 형식 또는 null>"}`;

const KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

export type RouterDecision = "RAG" | "MCP" | "HYBRID";

export interface RouterAction {
  tool: "getJiraIssue";
  args: { key: string };
}

export interface RouterResult {
  decision: RouterDecision;
  reason: string;
  mcpAction?: RouterAction;
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
}

function parseRouterResponse(raw: string): ParsedRouterPayload {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("router 응답이 비어있음");

  const parsed: unknown = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`router 응답 형식 오류: ${trimmed.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;

  const decision = obj.decision;
  if (decision !== "RAG" && decision !== "MCP" && decision !== "HYBRID") {
    throw new Error(`router decision 값 오류: ${JSON.stringify(decision)}`);
  }
  const reason = typeof obj.reason === "string" ? obj.reason : "";

  let issueKey: string | null = null;
  if (typeof obj.issueKey === "string" && KEY_PATTERN.test(obj.issueKey)) {
    issueKey = obj.issueKey;
  }
  return { decision, reason, issueKey };
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
  const mcpAction: RouterAction | undefined =
    (parsed.decision === "MCP" || parsed.decision === "HYBRID") && parsed.issueKey
      ? { tool: "getJiraIssue", args: { key: parsed.issueKey } }
      : undefined;

  log.info(
    {
      question,
      decision: parsed.decision,
      reason: parsed.reason,
      issueKey: parsed.issueKey,
      model: options.model,
    },
    "라우터 결정",
  );

  return { decision: parsed.decision, reason: parsed.reason, mcpAction };
}
