import { encode } from "gpt-tokenizer";
import { Chunk, type Document, uuidV5 } from "@/shared/index.js";

// Chunk ID는 documentId + chunkIndex 조합으로 결정적 생성
const CHUNK_UUID_NAMESPACE = "7a8b9c0d-1e2f-4a5b-8c9d-0e1f2a3b4c5d";

export interface ChunkOptions {
  maxTokens: number;
  overlapTokens: number;
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 512,
  overlapTokens: 64,
};

const HEADING_PATTERN = /^#{1,3} /;

function splitByHeadings(content: string): string[] {
  const lines = content.split("\n");
  const sections: string[] = [];
  let currentLines: string[] = [];

  for (const line of lines) {
    const isHeading = HEADING_PATTERN.test(line);
    if (isHeading && currentLines.length > 0) {
      sections.push(currentLines.join("\n"));
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }
  if (currentLines.length > 0) sections.push(currentLines.join("\n"));

  return sections.map((section) => section.trim()).filter((section) => section.length > 0);
}

function packParagraphs(text: string, maxTokens: number, overlapTokens: number): string[] {
  const totalTokens = encode(text).length;
  if (totalTokens <= maxTokens) return [text];

  const paragraphs = text.split(/\n{2,}/).filter((paragraph) => paragraph.trim().length > 0);
  const chunks: string[] = [];
  let currentParagraphs: string[] = [];
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = encode(paragraph).length;

    // 단일 문단이 한도 초과 — 그대로 한 청크로 처리 (드문 케이스, 추가 분할 생략)
    if (paragraphTokens > maxTokens) {
      if (currentParagraphs.length > 0) {
        chunks.push(currentParagraphs.join("\n\n"));
        currentParagraphs = [];
        currentTokens = 0;
      }
      chunks.push(paragraph);
      continue;
    }

    if (currentTokens + paragraphTokens > maxTokens && currentParagraphs.length > 0) {
      chunks.push(currentParagraphs.join("\n\n"));
      // 직전 문단을 다음 청크 시작에 포함시켜 경계 정보 보존
      const tailParagraph = currentParagraphs.at(-1);
      if (tailParagraph) {
        const tailTokens = encode(tailParagraph).length;
        if (tailTokens <= overlapTokens) {
          currentParagraphs = [tailParagraph, paragraph];
          currentTokens = tailTokens + paragraphTokens;
          continue;
        }
      }
      currentParagraphs = [paragraph];
      currentTokens = paragraphTokens;
      continue;
    }

    currentParagraphs.push(paragraph);
    currentTokens += paragraphTokens;
  }

  if (currentParagraphs.length > 0) chunks.push(currentParagraphs.join("\n\n"));
  return chunks;
}

function buildChunk(document: Document, content: string, chunkIndex: number): Chunk {
  const chunk = {
    id: uuidV5(`${document.id}:${chunkIndex}`, CHUNK_UUID_NAMESPACE),
    documentId: document.id,
    content,
    chunkIndex,
    tokenCount: encode(content).length,
    metadata: {
      source: document.source,
      sourceUrl: document.sourceUrl,
      title: document.title,
      author: document.author,
      permissions: document.permissions,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    },
  };
  return Chunk.parse(chunk);
}

export function chunkDocument(
  document: Document,
  options: Partial<ChunkOptions> = {},
): Chunk[] {
  const { maxTokens, overlapTokens } = { ...DEFAULT_CHUNK_OPTIONS, ...options };

  // 전체 문서가 한도 이내면 단일 청크 유지 (분할은 의미 단편화 비용)
  const totalTokens = encode(document.content).length;
  if (totalTokens <= maxTokens) {
    return [buildChunk(document, document.content, 0)];
  }

  const sections = splitByHeadings(document.content);
  const chunkTexts: string[] = [];
  for (const section of sections) {
    const packed = packParagraphs(section, maxTokens, overlapTokens);
    chunkTexts.push(...packed);
  }
  if (chunkTexts.length === 0) chunkTexts.push(document.content);

  return chunkTexts.map((content, chunkIndex) => buildChunk(document, content, chunkIndex));
}
