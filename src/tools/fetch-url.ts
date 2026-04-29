import { tool } from 'ai';
import { z } from 'zod';
import { LIMITS } from '../config.ts';

export const fetchUrlTool = tool({
  description: 'URL의 본문을 가져옵니다. HTML 태그 제거 후 잘라 반환합니다. 실패 시 에러를 데이터로 반환하니 다른 URL을 시도하세요.',
  parameters: z.object({
    url: z.string().min(1).describe('가져올 URL (http:// 또는 https://로 시작)'),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'deep-research-agent/0.1' } });
      if (!res.ok) return { error: `HTTP ${res.status} for ${url}` };

      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LIMITS.maxFetchedTextChars);
      return { url, text };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
