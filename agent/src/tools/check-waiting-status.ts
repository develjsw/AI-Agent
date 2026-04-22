import { llm } from '@livekit/agents';
import { z } from 'zod';
import { prisma } from '../prisma.js';

export const checkWaitingStatusTool = llm.tool({
  description: '특정 병원의 진료과 현재 대기 인원과 예상 대기 시간을 조회합니다.',
  parameters: z.object({
    hospitalId: z.number().describe('병원 ID'),
    departmentName: z.string().describe('진료과 이름 (예: 내과, 외과)'),
  }),
  execute: async ({ hospitalId, departmentName }) => {
    const status = await prisma.waitingStatus.findFirst({
      where: {
        hospitalId,
        department: { name: { contains: departmentName } },
      },
      include: { department: true, hospital: true },
    });

    if (!status) return '해당 진료과의 대기 정보를 찾을 수 없습니다.';
    return JSON.stringify(status);
  },
});
