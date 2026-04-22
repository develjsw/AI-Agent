import { llm } from '@livekit/agents';
import { z } from 'zod';
import { AppointmentStatus } from '@prisma/client';
import { prisma } from '../prisma.js';

export const createAppointmentTool = llm.tool({
  description: '의사와 날짜/시간을 지정하여 진료 예약을 생성합니다.',
  parameters: z.object({
    userId: z.number().describe('환자 ID'),
    doctorId: z.number().describe('의사 ID'),
    scheduledAt: z.string().describe('예약 일시 (ISO 8601 형식, 예: 2026-04-25T10:00:00)'),
    note: z.string().optional().describe('증상 또는 요청 사항'),
  }),
  execute: async ({ userId, doctorId, scheduledAt, note }) => {
    const scheduledDate = new Date(scheduledAt);

    const conflict = await prisma.appointment.findFirst({
      where: {
        doctorId,
        scheduledAt: scheduledDate,
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      },
    });

    if (conflict) return '해당 시간에 이미 예약이 존재합니다.';

    const appointment = await prisma.appointment.create({
      data: { userId, doctorId, scheduledAt: scheduledDate, note },
      include: {
        doctor: { include: { hospital: true, department: true } },
        user: true,
      },
    });

    return JSON.stringify(appointment);
  },
});
