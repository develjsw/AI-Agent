import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

const KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

// 라우터·합성 단계에서 흔히 인용되는 필드. customfield_* 노이즈 제거 목적
const DEFAULT_FIELDS = [
  "summary",
  "status",
  "assignee",
  "reporter",
  "description",
  "updated",
  "parent",
  "issuetype",
  "resolution",
];

let cachedCloudId: string | undefined;

export interface JiraIssueRaw {
  key: string;
  cloudId: string;
  content: unknown;
}

export interface JiraIssueSummary {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  resolution: string | null;
  assignee: string | null;
  reporter: string | null;
  parentKey: string | null;
  updated: string | null;
  description: string;
}

export interface GetJiraIssueOptions {
  fields?: string[];
  format?: "markdown" | "adf";
}

export async function getJiraIssue(
  client: Client,
  key: string,
  opts: GetJiraIssueOptions = {},
): Promise<JiraIssueRaw> {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`잘못된 Jira 키 형식: ${key} (예: ITSM-1234)`);
  }
  const cloudId = await resolveCloudId(client);
  const result = await client.callTool({
    name: "getJiraIssue",
    arguments: {
      cloudId,
      issueIdOrKey: key,
      fields: opts.fields ?? DEFAULT_FIELDS,
      responseContentFormat: opts.format ?? "markdown",
    },
  });
  if (result.isError) {
    throw new Error(`getJiraIssue 실패: ${stringifyResult(result)}`);
  }
  return { key, cloudId, content: extractContent(result) };
}

export function summarizeJiraIssue(
  raw: JiraIssueRaw,
  opts: { siteHost?: string } = {},
): JiraIssueSummary {
  if (typeof raw.content !== "object" || raw.content === null) {
    throw new Error(`정규화 실패 — content가 객체가 아님: ${JSON.stringify(raw.content)}`);
  }
  const fields = pickObject(raw.content as Record<string, unknown>, "fields") ?? {};
  const host = opts.siteHost ?? process.env.ATLASSIAN_SITE ?? "";
  const url = host ? `https://${host}/browse/${raw.key}` : `urn:atlassian:${raw.cloudId}:${raw.key}`;

  return {
    key: raw.key,
    url,
    summary: stringOr(fields.summary, ""),
    status: nestedString(fields.status, "name", ""),
    statusCategory: nestedString(pickObject(fields, "status")?.statusCategory, "name", ""),
    issueType: nestedString(fields.issuetype, "name", ""),
    resolution: nestedString(fields.resolution, "name", null),
    assignee: nestedString(fields.assignee, "displayName", null),
    reporter: nestedString(fields.reporter, "displayName", null),
    parentKey: nestedString(fields.parent, "key", null),
    updated: stringOr(fields.updated, null),
    description: stringOr(fields.description, ""),
  };
}

async function resolveCloudId(client: Client): Promise<string> {
  if (cachedCloudId) return cachedCloudId;
  const result = await client.callTool({
    name: "getAccessibleAtlassianResources",
    arguments: {},
  });
  if (result.isError) {
    throw new Error(`getAccessibleAtlassianResources 실패: ${stringifyResult(result)}`);
  }
  const parsed = extractContent(result);
  const id = pickFirstCloudId(parsed);
  if (!id) {
    throw new Error(`접근 가능한 Atlassian 리소스에서 cloudId를 찾지 못함: ${JSON.stringify(parsed)}`);
  }
  cachedCloudId = id;
  return id;
}

function pickFirstCloudId(parsed: unknown): string | undefined {
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const first = parsed[0];
  if (typeof first !== "object" || first === null) return undefined;
  const id = (first as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function extractContent(result: unknown): unknown {
  if (typeof result !== "object" || result === null) return result;
  const r = result as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (!Array.isArray(r.content)) return undefined;
  const first = r.content[0];
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

function pickObject(
  source: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!source) return undefined;
  const value = source[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function stringOr<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" ? value : fallback;
}

function nestedString<T extends string | null>(
  parent: unknown,
  key: string,
  fallback: T,
): string | T {
  if (typeof parent !== "object" || parent === null) return fallback;
  const value = (parent as Record<string, unknown>)[key];
  return typeof value === "string" ? value : fallback;
}

function stringifyResult(result: unknown): string {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
