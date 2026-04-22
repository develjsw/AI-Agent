import { llm } from '@livekit/agents';
import { z } from 'zod';
import { AppointmentStatus } from '../../prisma/generated/index.js';
import { prisma } from '../prisma.js';

export const getMyAppointmentsTool = llm.tool({
  description:
    '환자의 예약 목록을 조회합니다. 상태(PENDING, CONFIRMED, CANCELLED, COMPLETED)로 필터링 가능합니다.',
  parameters: z.object({
    userId: z.number().describe('환자 ID'),
    status: z
      .enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
      .optional()
      .describe('예약 상태 필터'),
  }),
  execute: async ({ userId, status }) => {
    const appointments = await prisma.appointment.findMany({
      where: {
        userId,
        ...(status ? { status: status as AppointmentStatus } : {}),
      },
      include: {
        doctor: { include: { hospital: true, department: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    if (appointments.length === 0) return '예약 내역이 없습니다.';
    return JSON.stringify(appointments);
  },
});
