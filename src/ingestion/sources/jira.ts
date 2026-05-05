import { createHash } from "node:crypto";
import { Document, child, loadConfig } from "@/shared/index.js";

const log = child({ module: "ingestion.jira" });

// Jira 키마다 동일한 UUID가 나오도록 고정한 namespace
const JIRA_UUID_NAMESPACE = "9b9c0d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(namespaceBytes).update(name).digest();
  const uuidBytes = Buffer.from(hash.subarray(0, 16));
  uuidBytes.writeUInt8((uuidBytes.readUInt8(6) & 0x0f) | 0x50, 6);
  uuidBytes.writeUInt8((uuidBytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = uuidBytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface JiraEnv {
  site: string;
  email: string;
  token: string;
}

export function loadJiraEnv(): JiraEnv {
  const config = loadConfig();
  if (!config.ATLASSIAN_SITE || !config.ATLASSIAN_EMAIL || !config.ATLASSIAN_API_TOKEN) {
    throw new Error(
      "Missing Atlassian environment for Jira ingestion: ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN",
    );
  }
  return {
    site: config.ATLASSIAN_SITE,
    email: config.ATLASSIAN_EMAIL,
    token: config.ATLASSIAN_API_TOKEN,
  };
}

const DEFAULT_FIELDS = [
  "summary",
  "description",
  "status",
  "issuetype",
  "priority",
  "created",
  "updated",
  "reporter",
  "assignee",
  "comment",
  "labels",
  "components",
];

interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

function isAdfNode(value: unknown): value is AdfNode {
  return typeof value === "object" && value !== null;
}

function headingLevel(attrs: Record<string, unknown> | undefined): number {
  const level = attrs?.level;
  if (typeof level === "number") return level;
  return 1;
}

function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (!isAdfNode(node)) return "";

  const children = (node.content ?? []).map(adfToText).join("");

  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "paragraph":
      return children + "\n\n";
    case "heading":
      return `${"#".repeat(headingLevel(node.attrs))} ${children}\n\n`;
    case "bulletList":
      return (
        (node.content ?? [])
          .map((item) => `- ${adfToText(item).trim()}\n`)
          .join("") + "\n"
      );
    case "orderedList":
      return (
        (node.content ?? [])
          .map((item, index) => `${index + 1}. ${adfToText(item).trim()}\n`)
          .join("") + "\n"
      );
    case "listItem":
      return children;
    case "codeBlock":
      return "```\n" + children + "\n```\n\n";
    case "blockquote":
      return children
        .split("\n")
        .map((line) => {
          if (!line) return line;
          return `> ${line}`;
        })
        .join("\n");
    case "rule":
      return "\n---\n";
    case "doc":
      return children;
    // 알 수 없는 타입은 자식 노드만 이어붙여 내용 손실 방지
    default:
      return children;
  }
}

interface JiraComment {
  id: string;
  body: AdfNode | null;
  created: string;
  author?: {
    accountId?: string;
    displayName?: string;
    accountType?: string;
  };
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: AdfNode | null;
    created: string;
    updated: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    reporter?: { accountId?: string; displayName?: string };
    assignee?: { accountId?: string; displayName?: string };
    comment?: { comments?: JiraComment[]; total?: number };
    labels?: string[];
    components?: Array<{ name?: string }>;
  };
}

interface SearchResponse {
  issues: JiraIssue[];
  isLast?: boolean;
  nextPageToken?: string;
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  readonly site: string;

  constructor(env: JiraEnv) {
    this.site = env.site;
    this.baseUrl = `https://${env.site}/rest/api/3`;
    this.authHeader =
      "Basic " + Buffer.from(`${env.email}:${env.token}`).toString("base64");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Jira API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }
    return (await response.json()) as T;
  }

  async getIssue(keyOrId: string, fields = DEFAULT_FIELDS): Promise<JiraIssue> {
    const params = new URLSearchParams({ fields: fields.join(",") });
    return this.request<JiraIssue>(`/issue/${encodeURIComponent(keyOrId)}?${params}`);
  }

  async *searchIssues(
    jql: string,
    fields = DEFAULT_FIELDS,
    batchSize = 50,
  ): AsyncGenerator<JiraIssue> {
    let nextPageToken: string | undefined;
    let pageNumber = 0;
    while (true) {
      const requestBody: Record<string, unknown> = {
        jql,
        fields,
        maxResults: batchSize,
      };
      if (nextPageToken) requestBody.nextPageToken = nextPageToken;

      const response = await this.request<SearchResponse>(`/search/jql`, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      pageNumber += 1;
      log.debug(
        { page: pageNumber, batch: response.issues.length, isLast: response.isLast },
        "search page",
      );
      for (const issue of response.issues) yield issue;
      if (response.isLast || !response.nextPageToken) break;
      nextPageToken = response.nextPageToken;
    }
  }
}

export function issueToDocument(issue: JiraIssue, site: string): Document {
  const key = issue.key;
  const summary = issue.fields.summary ?? "";
  const description = adfToText(issue.fields.description).trim();

  // 봇,자동화 댓글(accountType === "app")은 노이즈가 많아 제외
  const humanComments = (issue.fields.comment?.comments ?? []).filter(
    (comment) => comment.author?.accountType !== "app",
  );

  const commentsText = humanComments
    .map((comment) => {
      const author = comment.author?.displayName ?? "unknown";
      const createdAt = comment.created;
      const body = adfToText(comment.body).trim();
      return `### ${author} — ${createdAt}\n${body}`;
    })
    .join("\n\n");

  const sections = [`# [${key}] ${summary}`.trim()];
  if (description) sections.push(`## 설명\n${description}`);
  if (commentsText) sections.push(`## 댓글\n${commentsText}`);
  const content = sections.join("\n\n");

  const projectKey = key.split("-")[0] ?? "UNKNOWN";

  const document: Document = {
    id: uuidV5(`jira:${key}`, JIRA_UUID_NAMESPACE),
    source: "jira",
    sourceId: key,
    sourceUrl: `https://${site}/browse/${key}`,
    title: `[${key}] ${summary}`,
    content,
    createdAt: new Date(issue.fields.created),
    updatedAt: new Date(issue.fields.updated),
    author: issue.fields.reporter?.displayName,
    permissions: {
      public: false,
      projectKey,
    },
    metadata: {
      status: issue.fields.status?.name,
      statusCategory: issue.fields.status?.statusCategory?.key,
      issueType: issue.fields.issuetype?.name,
      priority: issue.fields.priority?.name,
      assigneeAccountId: issue.fields.assignee?.accountId,
      reporterAccountId: issue.fields.reporter?.accountId,
      labels: issue.fields.labels ?? [],
      components: (issue.fields.components ?? [])
        .map((component) => component.name)
        .filter(Boolean),
      commentCount: humanComments.length,
      commentCountWithBots: issue.fields.comment?.comments?.length ?? 0,
    },
  };

  return Document.parse(document);
}
