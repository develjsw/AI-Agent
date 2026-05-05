import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Chunk, child, loadConfig } from "@/shared/index.js";
import { embedTexts } from "@/ingestion/embed.js";
import { ChromaVectorStore, type UpsertItem } from "@/retrieval/vector-store.js";

const log = child({ module: "embed" });

const CHUNKED_DIR = resolve(process.cwd(), "data/chunked");
const COLLECTION_NAME = "documents";

function usage(): never {
  log.error("usage: pnpm embed jira");
  process.exit(1);
}

// Chroma metadata는 primitive(string/number/boolean)만 허용 → 평탄화
function flattenMetadata(chunk: Chunk): Record<string, string | number | boolean> {
  const metadata = chunk.metadata;
  return {
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    source: metadata.source,
    sourceUrl: metadata.sourceUrl,
    title: metadata.title,
    author: metadata.author ?? "",
    createdAt: metadata.createdAt.toISOString(),
    updatedAt: metadata.updatedAt.toISOString(),
    permissionsPublic: metadata.permissions.public,
    permissionsProjectKey: metadata.permissions.projectKey ?? "",
  };
}

async function loadChunks(source: string): Promise<Chunk[]> {
  const inputPath = resolve(CHUNKED_DIR, `${source}.jsonl`);
  const raw = await readFile(inputPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => Chunk.parse(JSON.parse(line)));
}

async function embedSource(source: string): Promise<void> {
  const config = loadConfig();
  const chunks = await loadChunks(source);
  log.info({ source, chunkCount: chunks.length }, "embedding chunks");

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  log.info(
    { embeddingCount: embeddings.length, dim: embeddings[0]?.length ?? 0 },
    "embeddings ready",
  );

  const store = new ChromaVectorStore({
    url: config.CHROMA_URL,
    collectionName: COLLECTION_NAME,
  });
  await store.init();

  const items: UpsertItem[] = chunks.map((chunk, index) => {
    const embedding = embeddings[index];
    if (!embedding) throw new Error(`missing embedding for chunk index ${index}`);
    return {
      id: chunk.id,
      embedding,
      document: chunk.content,
      metadata: flattenMetadata(chunk),
    };
  });
  await store.upsert(items);

  const totalCount = await store.count();
  log.info({ source, upserted: items.length, totalCount }, "embed complete");
}

async function main() {
  loadConfig();
  const [, , source] = process.argv;
  if (!source) usage();

  switch (source) {
    case "jira":
      await embedSource("jira");
      return;
    default:
      log.error({ source }, "unknown source — supported: jira");
      process.exit(1);
  }
}

main().catch((error) => {
  let message: unknown = error;
  if (error instanceof Error) message = error.message;
  log.error({ err: message }, "embed failed");
  process.exit(1);
});
