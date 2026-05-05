import { ChromaClient, type Collection, type Where } from "chromadb";
import { child } from "@/shared/index.js";

const log = child({ module: "retrieval.vector-store" });

export interface VectorStoreOptions {
  url: string;
  collectionName: string;
}

export interface UpsertItem {
  id: string;
  embedding: number[];
  document: string;
  metadata: Record<string, string | number | boolean>;
}

export interface QueryResult {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
  distance: number;
}

export class ChromaVectorStore {
  private readonly client: ChromaClient;
  private readonly collectionName: string;
  private collection: Collection | null = null;

  constructor(options: VectorStoreOptions) {
    const url = new URL(options.url);
    const isSecure = url.protocol === "https:";
    this.client = new ChromaClient({
      ssl: isSecure,
      host: url.hostname,
      port: Number(url.port) || (isSecure ? 443 : 80),
    });
    this.collectionName = options.collectionName;
  }

  async init(): Promise<void> {
    // 임베딩은 외부에서 제공하므로 default embedding function 비활성화
    this.collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
      embeddingFunction: { generate: async () => [] },
    });
    log.info({ collection: this.collectionName }, "collection ready");
  }

  private requireCollection(): Collection {
    if (!this.collection) throw new Error("call init() before using the vector store");
    return this.collection;
  }

  async upsert(items: UpsertItem[]): Promise<void> {
    if (items.length === 0) return;
    const collection = this.requireCollection();
    await collection.upsert({
      ids: items.map((item) => item.id),
      embeddings: items.map((item) => item.embedding),
      documents: items.map((item) => item.document),
      metadatas: items.map((item) => item.metadata),
    });
  }

  async count(): Promise<number> {
    return this.requireCollection().count();
  }

  async query(
    embedding: number[],
    topK: number,
    filter?: Where,
  ): Promise<QueryResult[]> {
    const result = await this.requireCollection().query({
      queryEmbeddings: [embedding],
      nResults: topK,
      where: filter,
    });

    const ids = result.ids[0] ?? [];
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, index) => ({
      id,
      document: documents[index] ?? "",
      metadata: (metadatas[index] ?? {}) as Record<string, unknown>,
      distance: distances[index] ?? 0,
    }));
  }
}
