# AI Agent Test

멀티에이전트·LLM 도구 사용 패턴 학습용 레포지토리

### 브랜치별 에이전트

| 브랜치 | 설명 |
|---|---|
| `feature/deep-research-agent` | 질문 분해 → 병렬 검색 → 종합 리포트 (현재 브랜치) |

## Deep Research Agent

Orchestrator–Workers 패턴 멀티에이전트 리서치 시스템.

**질문 → 오케스트레이터가 서브태스크로 분해 → 워커들이 병렬로 웹 검색·본문 추출 → 오케스트레이터가 인용 포함 리포트로 종합 → 토큰·비용 통계 출력.**

### 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 런타임 | Node.js (ESM, top-level await) |
| 언어 | TypeScript |
| 패키지 매니저 | pnpm |
| LLM 프레임워크 | Vercel AI SDK (`ai` + `@ai-sdk/openai`) |
| 모델 | OpenAI `gpt-5-mini` (config에서 변경) |
| 스키마·검증 | zod |
| 웹 검색 | Tavily API |
| 환경변수 | dotenv |

**핵심 API**: `generateText` + `tool()` + `maxSteps`. AI SDK가 LLM↔도구 자동 루프를 처리하므로 직접 while 루프 없이 멀티에이전트 구현 가능.

### 설치

```bash
pnpm install
```

### 환경변수 (`.env`)

```env
OPENAI_API_KEY=sk-...
TAVILY_API_KEY=tvly-...
```

- OpenAI 키: https://platform.openai.com/
- Tavily 키 (월 1k 요청 무료): https://tavily.com/

### 실행

```bash
pnpm research "<질문>"
```

예시:

```bash
pnpm research "PostgreSQL과 MongoDB 트랜잭션 처리 방식 차이"
```

### 출력 형식

콘솔에 순서대로:

1. **JSON line 트레이스** — 모든 이벤트 (`orchestrator_start`, `round_dispatch`, `tool_call`, `worker_done`, `final_report` 등)
2. **`=== 최종 리포트 ===`** — 종합 답변
3. **`=== 인용 ===`** — 출처 URL + 원문 인용
4. **`=== 실행 통계 ===`** — 소요 시간, 라운드/워커 수, 토큰, 예상 비용

### 동작 흐름

```
사용자 질문
    ↓
[orchestrator]
  ├─ 질문을 2~4개 서브태스크로 분해
  ├─ assign_to_workers (라운드 1)
  │    └─ Promise.all로 워커 N명 병렬 실행
  │         ├─ [worker r1-w1] web_search → fetch_url → submit_findings
  │         ├─ [worker r1-w2] ...
  │         └─ ...
  ├─ 결과 검토 — 부족하면 라운드 2 추가 (최대 3)
  └─ write_final_report → { summary, citations[] }
    ↓
사용자 출력 (리포트 + 통계)
```

### 폴더 구조

```
src/
├── index.ts                # CLI 진입점
├── config.ts               # MODELS + LIMITS (예산 한계)
├── schemas.ts              # zod: Citation / Task / Findings / Report
├── agents/
│   ├── orchestrator.ts     # research() — 분해·디스패치·종합
│   └── worker.ts           # runWorker() — 단일 질문 검색·정리
├── tools/
│   ├── web-search.ts       # Tavily 검색 도구
│   └── fetch-url.ts        # URL 본문 추출 도구
└── helper/
    ├── trace.ts            # 구조화 JSON line 로거
    ├── cost.ts             # Usage/Stats + 비용 계산
    └── error.ts            # toErrorMessage 헬퍼
```

### 안전장치

| 가드 | 위치 | 효과 |
|---|---|---|
| 라운드 ≤ 3 | `LIMITS.maxRounds` | 오케스트레이터의 무한 분해 방지 |
| 전체 워커 ≤ 10 | `LIMITS.maxWorkersTotal` | 워커 인플레이션 방지 |
| 워커 도구 호출 ≤ 5 | 시스템 프롬프트 | 워커 검색 폭주 방지 |
| 워커 step ≤ 8 | `LIMITS.maxWorkerSteps` | LLM 자동 루프 한계 |
| 오케스트레이터 step ≤ 8 | `LIMITS.maxOrchestratorSteps` | 동일 |
| zod 스키마 강제 | `Findings`, `Report` | 빈/잘못된 출력 거부 |
| try/catch 데이터 변환 | orchestrator | 워커 실패가 라운드 전체 중단 안 시킴 |
| 자유 텍스트 fallback | worker, orchestrator | 종결 도구 안 불러도 결과 반환 |

### 프로바이더 교체

OpenAI → Anthropic으로 변경:

```bash
pnpm add @ai-sdk/anthropic
```

```diff
  // src/agents/worker.ts, src/agents/orchestrator.ts
- import { openai } from '@ai-sdk/openai';
+ import { anthropic } from '@ai-sdk/anthropic';

- model: openai(MODELS.worker),
+ model: anthropic(MODELS.worker),
```

`src/config.ts`의 `MODELS` 값과 `src/helper/cost.ts`의 `PRICING` 단가도 같이 갱신.

### 참고

이 시스템은 Anthropic의 [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) 블로그에서 소개한 **Orchestrator–Workers** 패턴을 구현한 것. OpenAI Deep Research, Perplexity Research mode도 같은 아키텍처 골격을 사용함.
