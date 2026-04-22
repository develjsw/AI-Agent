import { llm } from '@livekit/agents';
import { z } from 'zod';
import { prisma } from '../prisma.js';

export const getHospitalDetailTool = llm.tool({
  description: '병원 ID로 병원 상세 정보(운영시간, 전화번호, 진료과, 대기현황)를 조회합니다.',
  parameters: z.object({
    hospitalId: z.number().describe('병원 ID'),
  }),
  execute: async ({ hospitalId }) => {
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        departments: { include: { department: true } },
        waitings: { include: { department: true } },
      },
    });

    if (!hospital) return '해당 병원을 찾을 수 없습니다.';
    return JSON.stringify(hospital);
  },
});
