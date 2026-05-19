import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { Chunk } from "@/shared/schema.js";
import { child } from "@/shared/index.js";

const log = child({ module: "retrieval.hybrid" });

const CHUNKED_DIR = resolve(process.cwd(), "data/chunked");
const RRF_K = 60;
// 영문/한글/숫자 + @, _, - 보존 (예: @kvx-screen, ITSM-2342)
const TOKEN_RE = /[\p{L}\p{N}@_-]+/gu;

const BM25_K1 = 1.5;
const BM25_B = 0.75;

export interface ScoredChunk {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface Ranking {
  id: string;
  rank: number;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

interface IndexedDoc {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  termFreqs: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private docs: IndexedDoc[] = [];
  private avgDocLength = 0;
  // 각 토큰이 등장한 doc 개수
  private docFreq = new Map<string, number>();

  add(id: string, content: string, metadata: Record<string, unknown>): void {
    const tokens = tokenize(content);
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }
    for (const token of termFreqs.keys()) {
      this.docFreq.set(token, (this.docFreq.get(token) ?? 0) + 1);
    }
    this.docs.push({ id, content, metadata, termFreqs, length: tokens.length });
  }

  finalize(): void {
    if (this.docs.length === 0) {
      this.avgDocLength = 0;
      return;
    }
    const totalLength = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.avgDocLength = totalLength / this.docs.length;
  }

  search(query: string, topK: number): ScoredChunk[] {
    const queryTokens = tokenize(query);
    const numDocs = this.docs.length;
    if (numDocs === 0 || queryTokens.length === 0) return [];

    const scores = new Array<number>(numDocs).fill(0);

    for (const token of queryTokens) {
      const termDocCount = this.docFreq.get(token);
      if (!termDocCount) continue;

      // Okapi BM25 IDF
      const idf = Math.log((numDocs - termDocCount + 0.5) / (termDocCount + 0.5) + 1);

      for (const [i, doc] of this.docs.entries()) {
        const termFreq = doc.termFreqs.get(token) ?? 0;
        if (termFreq === 0) continue;

        const numerator = termFreq * (BM25_K1 + 1);
        const denominator =
          termFreq + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / this.avgDocLength);
        scores[i] = (scores[i] ?? 0) + idf * (numerator / denominator);
      }
    }

    return this.docs
      .map((doc, i) => ({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        score: scores[i] ?? 0,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// 여러 소스의 JSONL 청크 파일을 단일 BM25 인덱스로 결합. 존재하지 않는 소스 파일은 건너뜀
export async function loadBm25Index(
  sources: string[] = ["jira", "confluence"],
): Promise<Bm25Index> {
  const index = new Bm25Index();
  const perSource: Record<string, number> = {};
  let totalChunks = 0;

  for (const source of sources) {
    const path = resolve(CHUNKED_DIR, `${source}.jsonl`);
    if (!(await fileExists(path))) {
      log.debug({ source, path }, "청크 파일 없음, 건너뜀");
      continue;
    }
    const raw = await readFile(path, "utf8");
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const chunk = Chunk.parse(JSON.parse(line));
      index.add(chunk.id, chunk.content, chunk.metadata);
    }
    perSource[source] = lines.length;
    totalChunks += lines.length;
  }

  index.finalize();
  log.info({ sources: perSource, totalChunks }, "BM25 인덱스 구축");
  return index;
}

// RRF: 여러 ranking을 1/(k+rank) 합산으로 결합
export function fuseRrf(rankings: Ranking[][], k = RRF_K): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    for (const { id, rank } of ranking) {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return fused;
}
