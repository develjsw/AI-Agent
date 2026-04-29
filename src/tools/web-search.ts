import { tool } from 'ai';
import { z } from 'zod';
import 'dotenv/config';
import { LIMITS } from '../config.ts';

const TavilyResponse = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string(),
    }),
  ),
});

export const webSearchTool = tool({
  description: '웹을 검색합니다. 제목, URL, 요약 스니펫이 포함된 상위 결과를 반환합니다. 실패 시 에러를 데이터로 반환하니 다른 쿼리를 시도하세요.',
  parameters: z.object({
    query: z.string().min(1).describe('검색 쿼리'),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return { error: 'TAVILY_API_KEY is not set in .env' };

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          max_results: LIMITS.maxSearchResults,
          include_answer: false,
        }),
      });
      if (!res.ok) return { error: `Tavily ${res.status}: ${await res.text()}` };

      const data = TavilyResponse.parse(await res.json());
      return data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
