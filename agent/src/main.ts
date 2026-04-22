import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import * as silero from '@livekit/agents-plugin-silero';
import { searchHospitalsTool } from './tools/search-hospitals.js';
import { getHospitalDetailTool } from './tools/get-hospital-detail.js';
import { checkWaitingStatusTool } from './tools/check-waiting-status.js';
import { recommendDepartmentTool } from './tools/recommend-department.js';
import { createAppointmentTool } from './tools/create-appointment.js';
import { cancelAppointmentTool } from './tools/cancel-appointment.js';
import { getMyAppointmentsTool } from './tools/get-my-appointments.js';

const INSTRUCTIONS = `
당신은 병원 예약 및 의료 정보를 도와주는 AI 음성 어시스턴트입니다.

역할:
- 사용자의 증상을 듣고 적합한 진료과를 추천합니다.
- 위치 또는 진료과 기준으로 병원을 검색합니다.
- 병원 상세 정보(운영시간, 전화번호, 진료과)를 제공합니다.
- 진료 예약 생성, 조회, 취소를 처리합니다.
- 병원 대기 현황을 안내합니다.

규칙:
- 항상 한국어로 친절하게 답변합니다.
- 예약 생성 전 반드시 날짜/시간/의사 정보를 확인합니다.
- 불확실한 정보는 추측하지 않고 도구를 사용해 조회합니다.
- 위 내용과 관련 없는 질문에는 답변이 어렵다고 안내합니다.
`.trim();

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      vad: ctx.proc.userData.vad as silero.VAD,
      llm: new google.beta.realtime.RealtimeModel({
        voice: 'Puck',
        instructions: INSTRUCTIONS,
        thinkingConfig: {
          includeThoughts: false,
        },
      }),
    });

    await session.start({
      agent: new voice.Agent({
        instructions: INSTRUCTIONS,
        tools: {
          searchHospitals: searchHospitalsTool,
          getHospitalDetail: getHospitalDetailTool,
          checkWaitingStatus: checkWaitingStatusTool,
          recommendDepartment: recommendDepartmentTool,
          createAppointment: createAppointmentTool,
          cancelAppointment: cancelAppointmentTool,
          getMyAppointments: getMyAppointmentsTool,
        },
      }),
      room: ctx.room,
    });

    const participant = await ctx.waitForParticipant();
    console.log(`참가자 연결됨: ${participant.identity}`);
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
