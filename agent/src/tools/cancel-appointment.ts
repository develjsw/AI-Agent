import { llm } from '@livekit/agents';
import { z } from 'zod';
import { AppointmentStatus } from '../../prisma/generated/index.js';
import { prisma } from '../prisma.js';

export const cancelAppointmentTool = llm.tool({
  description: '예약 ID와 환자 ID로 예약을 취소합니다.',
  parameters: z.object({
    appointmentId: z.number().describe('취소할 예약 ID'),
    userId: z.number().describe('환자 ID'),
  }),
  execute: async ({ appointmentId, userId }) => {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) return '예약을 찾을 수 없습니다.';
    if (appointment.userId !== userId) return '본인의 예약만 취소할 수 있습니다.';
    if (appointment.status === AppointmentStatus.CANCELLED) return '이미 취소된 예약입니다.';

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED },
      include: { doctor: { include: { hospital: true } } },
    });

    return JSON.stringify(updated);
  },
});
