# AI Agent Test

멀티에이전트·LLM 도구 사용 패턴 학습용 레포지토리

### 브랜치별 에이전트

| 브랜치 | 설명 |
|---|---|
| `feature/healthcare-voice-agent` | 음성 기반 단일 에이전트 + tool-use 루프 (현재 브랜치) |

## Healthcare Voice Agent

음성 기반 의료 어시스턴트. LiveKit으로 사용자와 실시간 음성 대화하며, Google Gemini Realtime LLM이 7개의 도구를 자율적으로 호출해 진료과 추천·병원 검색·예약 생성/조회/취소를 수행

### 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 실시간 음성 통신 | LiveKit (WebRTC 기반) |
| 음성 에이전트 프레임워크 | `@livekit/agents` |
| LLM | Google Gemini Realtime (`@livekit/agents-plugin-google`) |
| VAD (음성 활동 감지) | Silero (`@livekit/agents-plugin-silero`) |
| 백엔드 API | NestJS + LiveKit Server SDK |
| DB ORM | Prisma |
| DB | MySQL 8.0 (Docker) |
| 프론트엔드 | React 19 + Vite |
| 프론트 음성 UI | `@livekit/components-react` + `livekit-client` |
| 도구 인자 검증 | zod |
| 패키지 매니저 | pnpm |

**핵심 흐름**: 사용자 음성 → LiveKit 룸 → 에이전트 VAD → Gemini Realtime이 실시간으로 음성·텍스트·도구 호출을 처리 → DB 조작 → 응답을 음성으로 송출

### 설치

```bash
# 각 워크스페이스 의존성 설치
pnpm install --dir agent
pnpm install --dir server
pnpm install --dir client
```

### 환경변수 (`.env`)

루트의 `.env.example` 복사 후 값 채우기:

```env
# MySQL
MYSQL_ROOT_PASSWORD=
MYSQL_DATABASE=healthcare
MYSQL_USER=healthcare_user
MYSQL_PASSWORD=

# Prisma 연결 URL
DATABASE_URL="mysql://healthcare_user:PASSWORD@localhost:33060/healthcare"

# Google Gemini API
GOOGLE_API_KEY=

# LiveKit 서버
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=wss://your-livekit-server.livekit.cloud

# 브라우저용 LiveKit URL (LIVEKIT_URL과 동일)
VITE_LIVEKIT_URL=wss://your-livekit-server.livekit.cloud
```

- Google AI Studio 키: https://aistudio.google.com/
- LiveKit Cloud (무료 플랜 있음): https://cloud.livekit.io/

### 실행

```bash
# 1. MySQL 기동
docker compose up -d

# 2. Prisma 마이그레이션 + 시드 (server 워크스페이스에서)
pnpm --dir server prisma:migrate
pnpm --dir server prisma:seed

# 3. 백엔드 API (NestJS) — 토큰 발급 + 데이터 CRUD
pnpm --dir server start:dev

# 4. 음성 에이전트 (LiveKit Agents 워커)
pnpm --dir agent build
pnpm --dir agent dev

# 5. 프론트 (Vite)
pnpm --dir client dev
```

### 사용 방법

마이크 권한을 허용한 뒤 화면의 **"음성 세션 시작"** 버튼을 누르고 자연스럽게 말합니다.<br>
음성 어시스턴트가 대화 흐름에 따라 필요한 정보를 조회하거나 예약을 처리합니다.

대화 예시:
- "두통이 심한데 어느 진료과 가야 할까?"
- "강남 근처 내과 병원 추천해줘"
- "내 예약 목록 보여줘"
- "내일 오후 2시 예약 취소해줘"

<p>
  <img src="images/img.png" width="200" alt="음성 세션 시작 화면" />
  <img src="images/img2.png" width="200" alt="대화 진행 화면" />
  <img src="images/img3.png" width="200" alt="예약 결과 화면" />
  <img src="images/img4.png" width="200" alt="병원 정보 화면" />
</p>

### 동작 흐름

```
사용자 (브라우저 마이크)
    ↓ WebRTC
[LiveKit 룸]
    ↓
[agent 워커 — LiveKit Agents]
  ├─ Silero VAD가 발화 구간 감지
  ├─ Gemini Realtime LLM이 음성 직접 처리
  │    ├─ 도구 호출 결정 (recommend_department / search_hospitals / ...)
  │    └─ 도구 실행 결과를 컨텍스트에 누적
  ├─ services/* 가 DB(Prisma)에서 데이터 조회·갱신
  └─ 응답을 음성으로 변환해 룸으로 송출
    ↓
사용자에게 음성 응답
```

### 폴더 구조

```
.
├── agent/                       # LiveKit Agents 워커
│   └── src/
│       ├── main.ts              # 에이전트 정의 + 도구 등록 + LLM/VAD 설정
│       ├── prisma.ts            # Prisma 클라이언트
│       ├── services/            # DB 접근 계층
│       │   ├── appointment-service.ts
│       │   ├── department-service.ts
│       │   └── hospital-service.ts
│       └── tools/               # LLM이 부르는 도구 7개
│           ├── recommend-department.ts
│           ├── search-hospitals.ts
│           ├── get-hospital-detail.ts
│           ├── check-waiting-status.ts
│           ├── create-appointment.ts
│           ├── get-my-appointments.ts
│           ├── cancel-appointment.ts
│           └── tool-response.ts
├── server/                      # NestJS API
│   └── src/
│       ├── livekit/             # LiveKit 룸 토큰 발급
│       ├── hospitals/           # 병원 CRUD
│       ├── appointments/        # 예약 CRUD
│       └── prisma/              # Prisma 모듈
├── client/                      # React + Vite 프론트
│   └── src/
│       ├── App.tsx
│       ├── api/                 # 서버 호출
│       ├── components/          # 음성 UI
│       └── hooks/
├── docker-compose.yml           # MySQL 8.0
└── .env                         # 공통 환경변수
```

### 도구 목록 (LLM이 자율 호출)

| 도구 | 역할 |
|---|---|
| `recommendDepartment` | 증상 입력 받아 적합한 진료과 추천 |
| `searchHospitals` | 위치/진료과 기준 병원 검색 |
| `getHospitalDetail` | 특정 병원의 운영시간·전화·진료과 조회 |
| `checkWaitingStatus` | 대기 현황 확인 |
| `createAppointment` | 예약 생성 |
| `getMyAppointments` | 내 예약 목록 조회 |
| `cancelAppointment` | 예약 취소 |

각 도구는 zod 스키마로 인자 모양을 강제하고, `services/*`를 통해 Prisma로 DB에 접근.

### 안전장치

| 가드 | 위치 | 효과 |
|---|---|---|
| 인자 zod 검증 | 각 도구의 `parameters` | 잘못된 인자로 도구 실행되는 것 방지 |
| 시스템 프롬프트의 도메인 제한 | `agent/src/main.ts` `INSTRUCTIONS` | 의료/예약 외 질문엔 답변 어렵다고 안내 |
| 예약 생성 전 정보 확인 | 시스템 프롬프트 규칙 | 날짜/시간/의사 누락 시 LLM이 되묻도록 유도 |
| 환각 방지 | "추측하지 말고 도구로 조회" 명시 | LLM이 임의로 정보를 만들어내는 것 차단 |

### 단일 에이전트 vs 멀티에이전트

이 시스템은 **단일 에이전트 + 도구 사용 루프** 패턴 (`feature/deep-research-agent`의 멀티에이전트와 대조). LLM 1명이 7개 도구를 자율 선택하면서 한 대화 안에서 모든 작업을 처리

### 참고

LiveKit Agents 공식 문서: https://docs.livekit.io/agents/
