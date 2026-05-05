import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { Document, type Document as Doc } from "@/shared/schema.js";
import { child } from "@/shared/logger.js";

const log = child({ module: "ingestion.jira" });

// Stable namespace so re-ingesting the same key produces the same UUID.
const JIRA_UUID_NAMESPACE = "9b9c0d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

const JiraEnv = z.object({
  ATLASSIAN_SITE: z.string().min(1),
  ATLASSIAN_EMAIL: z.string().email(),
  ATLASSIAN_API_TOKEN: z.string().min(1),
});

export function loadJiraEnv() {
  const parsed = JiraEnv.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Missing Atlassian environment for Jira ingestion:\n${issues}`,
    );
  }
  return parsed.data;
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

/**
 * Walk an Atlassian Document Format tree and emit plain text.
 * Covers the block/inline node types we actually see in ITSM tickets.
 * Unknown nodes fall through to their children — never throw on shape drift.
 */
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
    case "heading": {
      const level = Number((node.attrs as { level?: number } | undefined)?.level ?? 1);
      return `${"#".repeat(level)} ${children}\n\n`;
    }
    case "bulletList":
      return (node.content ?? []).map((li) => `- ${adfToText(li).trim()}\n`).join("") + "\n";
    case "orderedList":
      return (
        (node.content ?? [])
          .map((li, i) => `${i + 1}. ${adfToText(li).trim()}\n`)
          .join("") + "\n"
      );
    case "listItem":
      return children;
    case "codeBlock":
      return "```\n" + children + "\n```\n\n";
    case "blockquote":
      return children
        .split("\n")
        .map((l) => (l ? `> ${l}` : l))
        .join("\n");
    case "rule":
      return "\n---\n";
    case "doc":
      return children;
    default:
      // Unknown — walk children rather than dropping content.
      return children;
  }
}

function isAdfNode(v: unknown): v is AdfNode {
  return typeof v === "object" && v !== null;
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

  constructor(env: { site: string; email: string; token: string }) {
    this.site = env.site;
    this.baseUrl = `https://${env.site}/rest/api/3`;
    this.authHeader =
      "Basic " + Buffer.from(`${env.email}:${env.token}`).toString("base64");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Jira API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }
    return (await res.json()) as T;
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
    let page = 0;
    while (true) {
      const body: Record<string, unknown> = {
        jql,
        fields,
        maxResults: batchSize,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const res = await this.request<SearchResponse>(`/search/jql`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      page += 1;
      log.debug({ page, batch: res.issues.length, isLast: res.isLast }, "search page");
      for (const issue of res.issues) yield issue;
      if (res.isLast || !res.nextPageToken) break;
      nextPageToken = res.nextPageToken;
    }
  }
}

/**
 * Convert a raw Jira issue into a normalized Document.
 * - Drops automation/bot comments (accountType === "app").
 * - Folds summary + description + human comments into a single content blob.
 */
export function issueToDocument(issue: JiraIssue, site: string): Doc {
  const key = issue.key;
  const summary = issue.fields.summary ?? "";
  const description = adfToText(issue.fields.description).trim();

  const humanComments = (issue.fields.comment?.comments ?? []).filter(
    (c) => c.author?.accountType !== "app",
  );

  const commentsText = humanComments
    .map((c) => {
      const who = c.author?.displayName ?? "unknown";
      const when = c.created;
      const body = adfToText(c.body).trim();
      return `### ${who} — ${when}\n${body}`;
    })
    .join("\n\n");

  const content = [
    `# [${key}] ${summary}`.trim(),
    description ? `## 설명\n${description}` : "",
    commentsText ? `## 댓글\n${commentsText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const projectKey = key.split("-")[0] ?? "UNKNOWN";

  const doc: Doc = {
    id: uuidv5(`jira:${key}`, JIRA_UUID_NAMESPACE),
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
      components: (issue.fields.components ?? []).map((c) => c.name).filter(Boolean),
      commentCount: humanComments.length,
      commentCountWithBots: issue.fields.comment?.comments?.length ?? 0,
    },
  };

  return Document.parse(doc);
}
