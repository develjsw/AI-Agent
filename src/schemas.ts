import { z } from 'zod';

export const Citation = z.object({
  url: z.string().min(1).describe('출처 URL (http:// 또는 https://로 시작)'),
  quote: z.string().min(1).describe('출처에서 그대로 따온 원문 인용'),
});
export type Citation = z.infer<typeof Citation>;

export const Task = z.object({
  id: z.string().min(1).describe('서브태스크 식별자 (예: t1, t2)'),
  question: z.string().min(1).describe('워커가 답할 구체적인 질문'),
  rationale: z.string().min(1).describe('이 정보가 왜 필요한지'),
});
export type Task = z.infer<typeof Task>;

export const WorkerResult = z.object({
  findings: z.string().min(1),
  citations: z.array(Citation),
});
export type WorkerResult = z.infer<typeof WorkerResult>;

export const Report = z.object({
  summary: z.string().min(1),
  citations: z.array(Citation),
});
export type Report = z.infer<typeof Report>;
