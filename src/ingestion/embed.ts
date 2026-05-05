import { loadConfig } from "@/shared/index.js";

export interface EmbedOptions {
  model?: string;
  batchSize?: number;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens: number; total_tokens: number };
}

export async function embedTexts(
  texts: string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const config = loadConfig();
  const model = options.model ?? config.EMBEDDING_MODEL;
  const batchSize = options.batchSize ?? 100;
  const apiKey = config.OPENAI_API_KEY;

  const embeddings: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI embeddings ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }
    const payload = (await response.json()) as EmbeddingResponse;
    // OpenAI 응답은 input 순서를 보장하지만 안전하게 index로 정렬
    const sorted = [...payload.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) embeddings.push(item.embedding);
  }
  return embeddings;
}
