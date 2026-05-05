## AI Agent

사내 통합 지식 어시스턴트 — RAG + MCP + LangGraph로 사내·외부 분산 데이터를 통합하고 자연어로 질의.

설계 문서: [`PLAN.md`](./PLAN.md) · 학습 트랙: [`ROADMAP.md`](./ROADMAP.md)

### 구조

```
src/
  shared/        # 공통 스키마(zod) · config · logger
  ingestion/     # 데이터 추출·정규화·청킹·임베딩
  retrieval/     # 벡터 + 하이브리드 검색
  agents/        # MCP 클라이언트 + LangGraph 오케스트레이터
  evaluation/    # 골든 Q&A 러너 + 메트릭
  api/           # 6단계: HTTP API (Hono/Fastify)
data/            # 로컬 raw·정규화·벡터 (gitignored)
```

import는 `@/shared`, `@/retrieval` 형식 (tsconfig paths).

### 시작

```bash
cp .env.example .env       # 키 채우기
pnpm install
pnpm chroma:up             # 로컬 Chroma 기동
pnpm typecheck             # 타입 체크
pnpm ingest <source>       # 인제스트 CLI (stage 1+)
pnpm eval                  # 평가 CLI (stage 1+)
```

### 단계별 진행 (PLAN.md §6)

- ✅ 0. 셋업
- ⏳ 1. 단일 소스 RAG (Confluence 등 1개)
- 2. 소스 추가 (Drive PDF + 종결 Jira)
- 3. 검색 품질 (BM25 + 리랭커)
- 4. MCP 라우터
- 5. LangGraph 재작성
- 6. HTTP API + 권한
- 7. 운영 (cron, 비용 추적)

### Branches

이전 학습 산출물은 별도 브랜치에 보관:
- `feature/healthcare-voice-agent`
- `feature/deep-research-agent` (Orchestrator-Workers + 비용 추적)
