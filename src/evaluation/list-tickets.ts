import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Document, child } from "@/shared/index.js";

const log = child({ module: "list-tickets" });

const JIRA_DIR = resolve(process.cwd(), "data/raw/jira");
const RICH_THRESHOLD = 500;

interface Row {
  key: string;
  chars: number;
  comments: number;
  issueType: string;
  status: string;
  title: string;
  snippet: string;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  return 0;
}

function snippetOf(content: string): string {
  // 타이틀은 별도 컬럼으로 표시하므로 본문만 추출
  const bodyLines: string[] = [];
  let pastTitle = false;
  for (const line of content.split("\n")) {
    if (!pastTitle) {
      if (line.startsWith("# ")) pastTitle = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed) bodyLines.push(trimmed);
  }
  return bodyLines.join(" ").replace(/\s+/g, " ").slice(0, 80);
}

async function loadRows(): Promise<Row[]> {
  const files = (await readdir(JIRA_DIR)).filter((file) => file.endsWith(".json"));
  const rows: Row[] = [];
  for (const file of files) {
    const raw = await readFile(resolve(JIRA_DIR, file), "utf8");
    const document = Document.parse(JSON.parse(raw));
    rows.push({
      key: document.sourceId,
      chars: document.content.length,
      comments: asNumber(document.metadata.commentCount),
      issueType: asString(document.metadata.issueType),
      status: asString(document.metadata.status),
      title: document.title,
      snippet: snippetOf(document.content),
    });
  }
  return rows;
}

function renderRow(row: Row): string {
  const chars = String(row.chars).padStart(5);
  const comments = String(row.comments).padStart(2);
  const head = `${row.key.padEnd(10)} ${chars}자 c=${comments}  ${row.issueType.padEnd(5)} ${row.status.padEnd(6)} ${row.title}`;
  if (!row.snippet) return head;
  return `${head}\n           ↳ ${row.snippet}`;
}

async function main() {
  const richMode = process.argv.slice(2).includes("--rich");

  const rows = await loadRows();
  rows.sort((rowA, rowB) => rowB.chars - rowA.chars);

  let filtered = rows;
  if (richMode) filtered = rows.filter((row) => row.chars >= RICH_THRESHOLD);

  let suffix = "";
  if (richMode) suffix = ` (--rich, ≥${RICH_THRESHOLD}자)`;
  console.log(`총 ${rows.length}건 중 ${filtered.length}건 표시${suffix}\n`);

  for (const row of filtered) {
    console.log(renderRow(row));
  }
}

main().catch((error) => {
  let message: unknown = error;
  if (error instanceof Error) message = error.message;
  log.error({ err: message }, "list-tickets failed");
  process.exit(1);
});
