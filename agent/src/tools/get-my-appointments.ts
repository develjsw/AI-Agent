import { llm } from '@livekit/agents';
import { z } from 'zod';
import { appointmentService } from '../services/appointment-service.js';
import { AppointmentStatus } from '../../prisma/generated/index.js';
import { failureResponse, successResponse } from './tool-response.js';

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
    const appointments = await appointmentService.listByUser(
      userId,
      status as AppointmentStatus | undefined,
    );

    if (appointments.length === 0) return failureResponse('예약 내역이 없습니다.');
    return successResponse(appointments);
  },
});
