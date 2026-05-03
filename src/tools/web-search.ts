import { tool } from 'ai';
import { z } from 'zod';
import { LIMITS } from '../config.ts';
import { toErrorMessage } from '../helper/error.ts';

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
  description: '웹을 검색해 상위 결과의 제목/URL/스니펫을 반환.',
  parameters: z.object({
    query: z.string().min(1).describe('검색 쿼리'),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return { error: 'TAVILY_API_KEY가 .env에 없음.' };

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
      return { error: toErrorMessage(err) };
    }
  },
});
