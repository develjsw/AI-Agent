import { tool } from 'ai';
import { z } from 'zod';
import { LIMITS } from '../config.ts';
import { toErrorMessage } from '../helper/error.ts';

export const fetchUrlTool = tool({
  description:
    'URL의 본문을 가져와 HTML 태그를 제거한 텍스트로 반환. web_search 스니펫만으론 부족할 때 본문을 더 깊이 볼 때 사용.',
  parameters: z.object({
    url: z.string().min(1).describe('가져올 URL (http:// 또는 https://로 시작)'),
  }),
  execute: async ({ url }) => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'deep-research-agent/0.1' },
      });
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
      return { error: toErrorMessage(err) };
    }
  },
});
