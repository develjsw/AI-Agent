import { openai } from '@ai-sdk/openai';
import { generateText, tool } from 'ai';
import { webSearchTool } from '../tools/web-search.ts';
import { fetchUrlTool } from '../tools/fetch-url.ts';
import { Findings, type Task } from '../schemas.ts';
import { MODELS, LIMITS } from '../config.ts';
import { trace } from '../helper/trace.ts';
import type { Usage } from '../helper/cost.ts';

const SYSTEM = `단일 리서치 질문에 집중하는 워커.

[가장 중요한 규칙]
- 종료는 오직 submit_findings 도구를 통해서만. 자유 텍스트 응답 금지.
- 외부 도구(web_search/fetch_url) 호출은 합쳐서 최대 ${LIMITS.maxToolCallsPerWorker}회. 그 이상은 submit_findings로 마무리.
- 검색이 잘 안 풀려도 절대 같은 쿼리를 변형해서 반복하지 말 것.

도구 사용:
1. web_search로 관련 출처 찾기. 쿼리는 자연어 단순하게. site:/따옴표 같은 연산자 쓰지 말 것.
2. 필요하면 fetch_url로 본문.
3. 정보가 모이면 submit_findings 호출.

품질:
- citations의 quote는 가능하면 원문 그대로. 어려우면 의역도 가능 — 원문 일치에 매달려 시간 낭비하지 말 것.
- findings는 짧게 (3~5문장).
- 못 찾으면 findings에 "정보 부족" 적고 citations는 빈 배열로 submit_findings.`;

export type WorkerCompletion = {
  findings: Findings;
  usage: Usage;
};

export async function runWorker(workerId: string, task: Task): Promise<WorkerCompletion> {
  let submission: Findings | null = null;

  const result = await generateText({
    model: openai(MODELS.worker),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `질문: ${task.question}\n이 정보가 필요한 이유: ${task.rationale}`,
      },
    ],
    tools: {
      web_search: webSearchTool,
      fetch_url: fetchUrlTool,
      submit_findings: tool({
        description:
          '최종 답변을 제출하는 종결 도구. 다른 모든 응답 방식보다 우선. 정확히 한 번만 호출.',
        parameters: Findings,
        execute: async (input) => {
          submission = input;
          return '답변 제출됨. 종료 가능.';
        },
      }),
    },
    maxSteps: LIMITS.maxWorkerSteps,
    onStepFinish({ toolCalls }) {
      for (const tc of toolCalls) {
        if (tc.toolName === 'submit_findings') continue;
        trace({ event: 'tool_call', agentId: workerId, tool: tc.toolName, args: tc.args });
      }
    },
  });

  const usage: Usage = {
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
  };

  if (submission) return { findings: submission, usage };

  if (result.text) {
    trace({
      event: 'agent_fallback',
      agentId: workerId,
      reason: 'submit_findings 호출 없이 종료. 텍스트로 대체.',
    });
    return { findings: { findings: result.text, citations: [] }, usage };
  }

  trace({
    event: 'agent_fallback',
    agentId: workerId,
    reason: '답변 생성 실패 (maxSteps 도달). 빈 결과 반환.',
  });
  return {
    findings: { findings: `(워커 ${workerId}: 답변을 생성하지 못함)`, citations: [] },
    usage,
  };
}
