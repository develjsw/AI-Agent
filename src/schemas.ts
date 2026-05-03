import { z } from 'zod';

export const Citation = z.object({
  url: z.string().min(1).describe('출처 URL (http:// 또는 https://로 시작)'),
  quote: z.string().min(1).describe('출처에서 그대로 따온 원문 인용'),
});
export type Citation = z.infer<typeof Citation>;

export const Task = z.object({
  id: z.string().min(1).describe('서브태스크 식별자 (예: t1, t2)'),
  question: z.string().min(1).describe('워커가 답할 구체적인 질문'),
  rationale: z.string().min(1).describe('이 정보가 왜 필요한지 (워커가 범위 좁히는 데 사용)'),
});
export type Task = z.infer<typeof Task>;

export const Findings = z.object({
  findings: z.string().min(1).describe('질문에 대한 답변 (한 단락)'),
  citations: z.array(Citation),
});
export type Findings = z.infer<typeof Findings>;

export const Report = z.object({
  summary: z.string().min(1).describe('사용자 질문에 대한 종합 답변'),
  citations: z.array(Citation).describe('답변을 뒷받침하는 인용. 워커들이 가져온 것에서 선택'),
});
export type Report = z.infer<typeof Report>;