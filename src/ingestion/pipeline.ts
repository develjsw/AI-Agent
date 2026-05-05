import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { child, loadConfig } from "@/shared/index.js";
import {
  JiraClient,
  issueToDocument,
  loadJiraEnv,
} from "@/ingestion/sources/jira.js";
import type { Document } from "@/shared/schema.js";
import * as process from "node:process";

const log = child({ module: "ingestion" });

const RAW_DIR = resolve(process.cwd(), "data/raw");

function usage(): never {
  log.error(
    [
      "usage:",
      "  pnpm ingest jira issue <KEY>           # e.g., ITSM-7573",
      "  pnpm ingest jira search '<JQL>'        # e.g., 'project = ITSM AND statusCategory = Done'",
    ].join("\n"),
  );
  process.exit(1);
}

async function saveDocument(doc: Document, subdir: string): Promise<string> {
  const dir = resolve(RAW_DIR, subdir);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${doc.sourceId}.json`);
  await writeFile(path, JSON.stringify(doc, null, 2), "utf8");
  return path;
}

async function ingestJira(args: string[]): Promise<void> {
  const env = loadJiraEnv();
  const client = new JiraClient({
    site: env.ATLASSIAN_SITE,
    email: env.ATLASSIAN_EMAIL,
    token: env.ATLASSIAN_API_TOKEN,
  });

  const [mode, ...rest] = args;
  if (mode === "issue") {
    const key = rest[0];
    if (!key) usage();
    log.info({ key }, "fetching issue");
    const issue = await client.getIssue(key);
    const doc = issueToDocument(issue, client.site);
    const path = await saveDocument(doc, "jira");
    log.info(
      {
        key,
        contentChars: doc.content.length,
        comments: doc.metadata.commentCount,
        commentsWithBots: doc.metadata.commentCountWithBots,
        path,
      },
      "saved",
    );
    return;
  }

  if (mode === "search") {
    const jql = rest.join(" ");
    if (!jql) usage();
    log.info({ jql }, "searching");
    let count = 0;
    for await (const issue of client.searchIssues(jql)) {
      const doc = issueToDocument(issue, client.site);
      await saveDocument(doc, "jira");
      count += 1;
      if (count % 10 === 0) log.info({ count }, "ingested");
    }
    log.info({ count, jql }, "search ingestion complete");
    return;
  }

  usage();
}

async function main() {
  loadConfig();
  const [, , source, ...rest] = process.argv;
  if (!source) usage();

  switch (source) {
    case "jira":
      await ingestJira(rest);
      break;
    default:
      log.error({ source }, "unknown source — supported: jira");
      process.exit(1);
  }
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.message : err }, "ingestion failed");
  process.exit(1);
});
