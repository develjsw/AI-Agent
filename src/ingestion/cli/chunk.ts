import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Document, child, loadConfig } from "@/shared/index.js";
import { chunkDocument } from "@/ingestion/chunk.js";

const log = child({ module: "chunk" });

const RAW_DIR = resolve(process.cwd(), "data/raw");
const CHUNKED_DIR = resolve(process.cwd(), "data/chunked");

function usage(): never {
  log.error(
    [
      "usage:",
      "  pnpm chunk jira    # data/raw/jira/*.json → data/chunked/jira.jsonl",
    ].join("\n"),
  );
  process.exit(1);
}

async function chunkSource(source: string): Promise<void> {
  const inputDir = resolve(RAW_DIR, source);
  const files = (await readdir(inputDir)).filter((file) => file.endsWith(".json"));

  await mkdir(CHUNKED_DIR, { recursive: true });
  const outputPath = resolve(CHUNKED_DIR, `${source}.jsonl`);

  let documentCount = 0;
  let chunkCount = 0;
  let totalTokens = 0;
  const lines: string[] = [];

  for (const file of files) {
    const raw = await readFile(resolve(inputDir, file), "utf8");
    const document = Document.parse(JSON.parse(raw));
    const chunks = chunkDocument(document);
    documentCount += 1;
    chunkCount += chunks.length;
    for (const chunk of chunks) {
      totalTokens += chunk.tokenCount ?? 0;
      lines.push(JSON.stringify(chunk));
    }
  }

  await writeFile(outputPath, lines.join("\n") + "\n", "utf8");

  log.info(
    {
      source,
      documentCount,
      chunkCount,
      avgChunksPerDoc: documentCount > 0 ? +(chunkCount / documentCount).toFixed(2) : 0,
      totalTokens,
      outputPath,
    },
    "chunking complete",
  );
}

async function main() {
  loadConfig();
  const [, , source] = process.argv;
  if (!source) usage();

  switch (source) {
    case "jira":
      await chunkSource("jira");
      return;
    default:
      log.error({ source }, "unknown source — supported: jira");
      process.exit(1);
  }
}

main().catch((error) => {
  let message: unknown = error;
  if (error instanceof Error) message = error.message;
  log.error({ err: message }, "chunking failed");
  process.exit(1);
});
