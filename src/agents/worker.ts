import { generateText, tool } from 'ai';
import { getModel } from '../lib/llm.ts';
import { trace } from '../lib/trace.ts';
import { LIMITS, MODELS } from '../config.ts';
import { WorkerResult, type Task, type WorkerResult as WorkerResultT } from '../schemas.ts';
import { workerExternalTools } from '../tools/index.ts';

const SYSTEM = `당신은 단일 리서치 질문에 집중하는 워커 에이전트입니다.

역할:
1. web_search와 fetch_url로 정보를 수집합니다.
2. 모든 사실은 출처 URL과 원문 인용(verbatim quote)으로 뒷받침합니다.
3. 충분한 정보가 모이면 submit_findings를 정확히 한 번 호출합니다.

규칙:
- 'findings'에 적은 모든 사실은 'citations' 배열에 대응 인용이 있어야 합니다.
- citations의 quote는 출처 원문을 그대로 따와야 합니다 (의역 금지).
- findings는 한 단락으로 간결하게 작성합니다.
- 외부 도구 호출은 최대 ${LIMITS.maxToolCallsPerWorker}회까지만 허용됩니다.`;

export async function runWorker(workerId: string, task: Task): Promise<WorkerResultT> {
  const start = Date.now();
  trace({ event: 'worker_start', workerId, question: task.question });

  let submission: WorkerResultT | null = null;

  const result = await generateText({
    model: getModel(MODELS.worker),
    maxTokens: LIMITS.maxOutputTokensWorker,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Question: ${task.question}\nWhy this matters: ${task.rationale}`,
      },
    ],
    tools: {
      ...workerExternalTools,
      submit_findings: tool({
        description:
          '이 리서치 태스크의 최종 결과를 제출합니다. 충분한 정보가 모였을 때 정확히 한 번만 호출하세요.',
        parameters: WorkerResult,
        execute: async (input) => {
          submission = input;
          return '결과가 기록되었습니다. 종료해도 됩니다.';
        },
      }),
    },
    maxSteps: LIMITS.maxToolCallsPerWorker + 2,
    onStepFinish: ({ toolCalls }) => {
      for (const tc of toolCalls) {
        if (tc.toolName === 'submit_findings') continue;
        trace({ event: 'tool_call', agentId: workerId, tool: tc.toolName, input: tc.args });
      }
    },
  });

  trace({
    event: 'worker_end',
    workerId,
    ms: Date.now() - start,
    tokensIn: result.usage.promptTokens,
    tokensOut: result.usage.completionTokens,
  });

  if (submission) return submission;
  return {
    findings: '(워커가 submit_findings 없이 종료됨.)',
    citations: [],
  };
}
