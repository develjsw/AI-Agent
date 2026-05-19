import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Document, child, loadConfig } from "@/shared/index.js";
import {
  JiraClient,
  issueToDocument,
  loadJiraEnv,
} from "@/ingestion/sources/jira.js";
import {
  ConfluenceClient,
  loadConfluenceEnv,
  pageToDocument,
} from "@/ingestion/sources/confluence.js";

const log = child({ module: "ingestion" });

const RAW_DIR = resolve(process.cwd(), "data/raw");

function usage(): never {
  log.error(
    [
      "usage:",
      "  pnpm ingest jira issue <KEY>                 # e.g., ITSM-7573",
      "  pnpm ingest jira search '<JQL>'              # e.g., 'project = ITSM AND statusCategory = Done'",
      "  pnpm ingest confluence page <PAGE_ID>        # e.g., 1234567890",
      "  pnpm ingest confluence space <SPACE_KEY>     # 스페이스 내 모든 페이지",
    ].join("\n"),
  );
  process.exit(1);
}

async function saveDocument(document: Document, subDirectory: string): Promise<string> {
  const directory = resolve(RAW_DIR, subDirectory);
  await mkdir(directory, { recursive: true });
  const filePath = resolve(directory, `${document.sourceId}.json`);
  await writeFile(filePath, JSON.stringify(document, null, 2), "utf8");
  return filePath;
}

async function ingestJiraIssue(client: JiraClient, key: string): Promise<void> {
  log.info({ key }, "fetching issue");
  const issue = await client.getIssue(key);
  const document = issueToDocument(issue, client.site);
  const filePath = await saveDocument(document, "jira");
  log.info(
    {
      key,
      contentChars: document.content.length,
      comments: document.metadata.commentCount,
      commentsWithBots: document.metadata.commentCountWithBots,
      filePath,
    },
    "saved",
  );
}

async function ingestJiraSearch(client: JiraClient, jql: string): Promise<void> {
  log.info({ jql }, "searching");
  let count = 0;
  for await (const issue of client.searchIssues(jql)) {
    const document = issueToDocument(issue, client.site);
    await saveDocument(document, "jira");
    count += 1;
    if (count % 10 === 0) log.info({ count }, "ingested");
  }
  log.info({ count, jql }, "search ingestion complete");
}

async function ingestJira(args: string[]): Promise<void> {
  const client = new JiraClient(loadJiraEnv());

  const [mode, ...rest] = args;
  switch (mode) {
    case "issue": {
      const key = rest[0];
      if (!key) usage();
      await ingestJiraIssue(client, key);
      return;
    }
    case "search": {
      const jql = rest.join(" ");
      if (!jql) usage();
      await ingestJiraSearch(client, jql);
      return;
    }
    default:
      usage();
  }
}

async function ingestConfluencePage(client: ConfluenceClient, pageId: string): Promise<void> {
  log.info({ pageId }, "fetching confluence page");
  const page = await client.getPage(pageId);
  const document = pageToDocument(page, client.site);
  const filePath = await saveDocument(document, "confluence");
  log.info(
    {
      pageId,
      title: document.title,
      contentChars: document.content.length,
      bodyChars: document.metadata.bodyChars,
      spaceKey: document.permissions.spaceKey,
      filePath,
    },
    "saved",
  );
}

async function ingestConfluenceSpace(client: ConfluenceClient, spaceKey: string): Promise<void> {
  log.info({ spaceKey }, "resolving space");
  const space = await client.getSpaceByKey(spaceKey);
  log.info({ spaceKey, spaceId: space.id, name: space.name }, "space resolved, listing pages");

  let count = 0;
  for await (const page of client.listPagesInSpace(space.id)) {
    const document = pageToDocument(page, client.site);
    await saveDocument(document, "confluence");
    count += 1;
    if (count % 10 === 0) log.info({ count }, "ingested");
  }
  log.info({ count, spaceKey }, "space ingestion complete");
}

async function ingestConfluence(args: string[]): Promise<void> {
  const client = new ConfluenceClient(loadConfluenceEnv());

  const [mode, ...rest] = args;
  switch (mode) {
    case "page": {
      const pageId = rest[0];
      if (!pageId) usage();
      await ingestConfluencePage(client, pageId);
      return;
    }
    case "space": {
      const spaceKey = rest[0];
      if (!spaceKey) usage();
      await ingestConfluenceSpace(client, spaceKey);
      return;
    }
    default:
      usage();
  }
}

async function main() {
  loadConfig();
  const [, , source, ...args] = process.argv;
  if (!source) usage();

  switch (source) {
    case "jira":
      await ingestJira(args);
      return;
    case "confluence":
      await ingestConfluence(args);
      return;
    default:
      log.error({ source }, "unknown source — supported: jira, confluence");
      process.exit(1);
  }
}

main().catch((error) => {
  let message: unknown = error;
  if (error instanceof Error) message = error.message;
  log.error({ err: message }, "ingestion failed");
  process.exit(1);
});
