import { generateText, tool } from 'ai';
import { z } from 'zod';
import { getModel } from '../lib/llm.ts';
import { trace } from '../lib/trace.ts';
import { LIMITS, MODELS } from '../config.ts';
import { Report, Task, type Report as ReportT } from '../schemas.ts';
import { runWorker } from './worker.ts';

const DispatchInput = z.object({
  tasks: z
    .array(Task)
    .min(1)
    .max(LIMITS.maxWorkersTotal)
    .describe('독립적인 서브태스크들. 각 태스크는 별도 워커에서 병렬 실행됩니다.'),
});

const SYSTEM = `당신은 병렬 워커들을 조율하는 리서치 오케스트레이터입니다.

역할:
1. 사용자 질문을 독립적이고 초점이 분명한 서브태스크들로 분해합니다.
2. dispatch_workers로 서브태스크들을 보냅니다. 워커들은 병렬 실행되어 findings + citations를 반환합니다.
3. 워커 결과를 검토합니다. 정보가 부족하면 새 라운드를 디스패치합니다 (중복 서브태스크 금지).
4. 충분히 모이면 write_final_report로 종합된 요약과 모든 인용을 작성합니다.

하드 제약:
- 디스패치 라운드 최대 ${LIMITS.maxRounds}회.
- 전체 워커 합계 최대 ${LIMITS.maxWorkersTotal}명.
- 최종 리포트의 모든 주장은 워커가 가져온 인용으로 뒷받침되어야 합니다.

스타일:
- 서브태스크는 구체적이고 답변 가능하며 서로 겹치지 않게 설계합니다.
- 최종 요약은 사용자 질문에 직접 답합니다.`;

export async function research(question: string): Promise<ReportT> {
  trace({ event: 'orchestrator_start', question });

  let round = 0;
  let totalWorkers = 0;
  let report: ReportT | null = null;

  await generateText({
    model: getModel(MODELS.orchestrator),
    maxTokens: LIMITS.maxOutputTokensOrchestrator,
    system: SYSTEM,
    messages: [{ role: 'user', content: question }],
    tools: {
      dispatch_workers: tool({
        description:
          '질문을 서브태스크로 분해해 병렬 워커들에게 디스패치합니다. 각 워커는 findings + citations를 반환합니다.',
        parameters: DispatchInput,
        execute: async ({ tasks }) => {
          if (round >= LIMITS.maxRounds) {
            return { error: `라운드 예산 소진 (${LIMITS.maxRounds}회). 지금 write_final_report를 호출하세요.` };
          }
          const remaining = LIMITS.maxWorkersTotal - totalWorkers;
          if (remaining <= 0) {
            return { error: `워커 예산 소진 (${LIMITS.maxWorkersTotal}명). 지금 write_final_report를 호출하세요.` };
          }

          const accepted = tasks.slice(0, remaining);
          round += 1;
          totalWorkers += accepted.length;

          trace({
            event: 'orchestrator_round',
            round,
            tasks: accepted.map((t) => ({ id: t.id, question: t.question })),
          });

          return Promise.all(
            accepted.map(async (t, i) => {
              try {
                const r = await runWorker(`r${round}-w${i + 1}`, t);
                return {
                  taskId: t.id,
                  question: t.question,
                  findings: r.findings,
                  citations: r.citations,
                };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                  taskId: t.id,
                  question: t.question,
                  findings: `(워커 실패: ${message})`,
                  citations: [],
                };
              }
            }),
          );
        },
      }),
      write_final_report: tool({
        description: '최종 종합 리포트를 작성합니다. 정확히 한 번만 호출하세요.',
        parameters: Report,
        execute: async (input) => {
          report = input;
          trace({ event: 'final_report', citationCount: input.citations.length });
          return '리포트가 기록되었습니다.';
        },
      }),
    },
    maxSteps: LIMITS.maxOrchestratorSteps,
  });

  if (!report) {
    throw new Error('Orchestrator did not call write_final_report.');
  }
  return report;
}
