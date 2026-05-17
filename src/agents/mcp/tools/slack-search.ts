import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const TOOL_NAME = "slack_search_public_and_private";
const DEFAULT_LIMIT = 10;

export interface SlackSearchRaw {
  query: string;
  content: unknown;
}

// Slack MCP는 응답을 markdown 텍스트로 미리 정형화해 반환.
// 우리는 파싱 없이 그대로 LLM 컨텍스트에 합성하고 메타만 발췌
export interface SlackSearchSummary {
  query: string;
  markdown: string;
  resultCount: number;
  nextCursor: string | null;
}

export interface SearchSlackOptions {
  limit?: number;
  includeContext?: boolean;
}

export async function searchSlack(
  client: Client,
  query: string,
  options: SearchSlackOptions = {},
): Promise<SlackSearchRaw> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    throw new Error("Slack 검색 query가 비어있음");
  }
  const result = await client.callTool({
    name: TOOL_NAME,
    arguments: {
      query: trimmedQuery,
      limit: options.limit ?? DEFAULT_LIMIT,
      include_context: options.includeContext ?? false,
    },
  });
  if (result.isError) {
    throw new Error(`Slack 검색 실패: ${stringifyResult(result)}`);
  }
  return { query: trimmedQuery, content: extractContent(result) };
}

// Slack MCP 응답 형태: { results: "<markdown>", pagination_info: "...cursor `XXX`..." }
export function summarizeSlackSearch(raw: SlackSearchRaw): SlackSearchSummary {
  const empty: SlackSearchSummary = {
    query: raw.query,
    markdown: "",
    resultCount: 0,
    nextCursor: null,
  };
  if (typeof raw.content !== "object" || raw.content === null) return empty;

  const root = raw.content as Record<string, unknown>;
  const markdown = stringOr(root.results, "");
  const pagination = stringOr(root.pagination_info, "");

  // "## Messages (10 results)" 패턴에서 카운트 추출
  const countMatch = markdown.match(/## Messages \((\d+) results?\)/);
  const resultCount = countMatch?.[1] ? Number(countMatch[1]) : 0;

  // "cursor `XXX`" 패턴에서 다음 페이지 cursor 추출
  const cursorMatch = pagination.match(/cursor `([^`]+)`/);
  const nextCursor = cursorMatch?.[1] ?? null;

  return { query: raw.query, markdown, resultCount, nextCursor };
}

function extractContent(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  const resultRecord = result as { structuredContent?: unknown; content?: unknown };
  if (resultRecord.structuredContent !== undefined) return resultRecord.structuredContent;
  if (!Array.isArray(resultRecord.content)) return undefined;
  const first = resultRecord.content[0];
  if (!first || typeof first !== "object") return undefined;
  const obj = first as { type?: string; text?: string };
  if (obj.type === "text" && typeof obj.text === "string") {
    return safeJsonParse(obj.text);
  }
  return obj;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

function stringifyResult(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
