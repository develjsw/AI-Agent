import { openai } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { Task, Report } from '../schemas.ts';
import { runWorker } from './worker.ts';
import { MODELS, LIMITS } from '../config.ts';
import { trace } from '../helper/trace.ts';
import { toErrorMessage } from '../helper/error.ts';
import { calcCost, sumUsage, type Stats, type Usage } from '../helper/cost.ts';

const AssignInput = z.object({
  tasks: z
    .array(Task)
    .min(1)
    .max(LIMITS.maxWorkersTotal)
    .describe('이번 라운드에 병렬로 할당할 서브태스크들. 한 번 호출 = 한 라운드.'),
});

const SYSTEM = `리서치 오케스트레이터.

[가장 중요한 규칙]
- 종료는 오직 write_final_report 도구를 통해서만. 자유 텍스트 응답 금지.
- 라운드 최대 ${LIMITS.maxRounds}회, 전체 워커 최대 ${LIMITS.maxWorkersTotal}명. 그 이상은 거부됨.

역할:
1. 사용자 질문을 2~4개의 짧고 독립적인 서브태스크로 분해 (자명한 질문이면 1개도 가능).
2. assign_to_workers를 한 번 호출해서 그 라운드의 모든 서브태스크를 한꺼번에 보냄. 워커들이 병렬로 돌아 findings + citations 배열로 돌려줌.
3. 결과 검토 — 부족하면 새 라운드로 보충 서브태스크를 또 보냄 (이전과 겹치지 않게). 충분하면 바로 종합.
4. write_final_report로 종합 리포트 작성.

서브태스크 작성 규칙:
- task.question은 한 줄로 짧게 (한 문장). 긴 요구사항 나열 금지.
- "원문 인용 그대로" 같은 무거운 제약 강요하지 말 것. 워커가 알아서 함.
- 같은 라운드 안에서 서로 겹치지 않게 분해. 다음 라운드도 이전과 다른 각도로.

리포트 규칙:
- summary는 사용자 질문에 직접 답해야 함.
- citations는 워커들이 가져온 것에서 선택. 새로 만들지 말 것.`;

async function runWorkersInParallel(
  round: number,
  tasks: Task[],
  collectUsage: (usage: Usage) => void,
) {
  return Promise.all(
    tasks.map(async (task, i) => {
      const workerId = `r${round}-w${i + 1}`;
      try {
        const completion = await runWorker(workerId, task);
        collectUsage(completion.usage);
        trace({
          event: 'worker_done',
          agentId: workerId,
          citationCount: completion.findings.citations.length,
        });
        return { taskId: task.id, ...completion.findings };
      } catch (err) {
        // 워커가 throw해도 데이터로 변환 — 한 워커 실패가 라운드 전체를 무너뜨리지 않도록.
        const message = toErrorMessage(err);
        trace({ event: 'worker_failed', agentId: workerId, message });
        return {
          taskId: task.id,
          findings: `(워커 ${workerId} 실패: ${message})`,
          citations: [],
        };
      }
    }),
  );
}

export type ResearchResult = {
  report: Report;
  stats: Stats;
};

export async function research(question: string): Promise<ResearchResult> {
  const startMs = Date.now();
  const workerUsages: Usage[] = [];
  let report: Report | null = null;
  let round = 0;
  let totalWorkers = 0;

  trace({ event: 'orchestrator_start', question });

  const result = await generateText({
    model: openai(MODELS.orchestrator),
    system: SYSTEM,
    messages: [{ role: 'user', content: question }],
    tools: {
      assign_to_workers: tool({
        description:
          '여러 서브태스크를 워커들에게 한 번에 병렬 할당하고, 각 워커의 findings + citations를 배열로 받음. 호출 1회 = 라운드 1회. 예산이 소진되면 에러 데이터가 반환되니 즉시 write_final_report 호출할 것.',
        parameters: AssignInput,
        execute: async ({ tasks }) => {
          if (round >= LIMITS.maxRounds) {
            trace({ event: 'budget_exceeded', budget: 'rounds', limit: LIMITS.maxRounds });
            return { error: '라운드 예산 소진. 지금 write_final_report 호출할 것.' };
          }
          const remaining = LIMITS.maxWorkersTotal - totalWorkers;
          if (remaining <= 0) {
            trace({ event: 'budget_exceeded', budget: 'workers', limit: LIMITS.maxWorkersTotal });
            return { error: '워커 예산 소진. 지금 write_final_report 호출할 것.' };
          }

          const accepted = tasks.slice(0, remaining);
          round += 1;
          totalWorkers += accepted.length;

          trace({
            event: 'round_dispatch',
            round,
            tasks: accepted.map((t) => ({ id: t.id, question: t.question })),
          });

          return runWorkersInParallel(round, accepted, (u) => workerUsages.push(u));
        },
      }),
      write_final_report: tool({
        description:
          '최종 종합 리포트를 작성. 다른 모든 응답 방식보다 우선. 정확히 한 번만 호출.',
        parameters: Report,
        execute: async (input) => {
          report = input;
          trace({ event: 'final_report', citationCount: input.citations.length });
          return '리포트 기록 완료. 종료 가능.';
        },
      }),
    },
    maxSteps: LIMITS.maxOrchestratorSteps,
  });

  const orchestratorUsage: Usage = {
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
  };
  const orchestratorCost = calcCost(MODELS.orchestrator, orchestratorUsage);
  const workersCost = workerUsages.reduce((sum, u) => sum + calcCost(MODELS.worker, u), 0);
  const totalUsage = sumUsage([orchestratorUsage, ...workerUsages]);

  const stats: Stats = {
    elapsedMs: Date.now() - startMs,
    rounds: round,
    workers: totalWorkers,
    promptTokens: totalUsage.promptTokens,
    completionTokens: totalUsage.completionTokens,
    totalCost: orchestratorCost + workersCost,
  };

  if (report) return { report, stats };

  if (result.text) {
    trace({
      event: 'agent_fallback',
      agentId: 'orchestrator',
      reason: 'write_final_report 없이 종료. 텍스트로 대체.',
    });
    return { report: { summary: result.text, citations: [] }, stats };
  }

  throw new Error('리포트를 받지 못함.');
}
