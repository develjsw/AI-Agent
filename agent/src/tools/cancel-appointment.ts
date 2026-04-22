import { llm } from '@livekit/agents';
import { z } from 'zod';
import { appointmentService } from '../services/appointment-service.js';
import { failureResponse, successResponse } from './tool-response.js';

export const cancelAppointmentTool = llm.tool({
  description: '예약 ID와 환자 ID로 예약을 취소합니다.',
  parameters: z.object({
    appointmentId: z.number().describe('취소할 예약 ID'),
    userId: z.number().describe('환자 ID'),
  }),
  execute: async ({ appointmentId, userId }) => {
    const result = await appointmentService.cancel(appointmentId, userId);

    switch (result.type) {
      case 'not_found':
        return failureResponse('예약을 찾을 수 없습니다.');
      case 'forbidden':
        return failureResponse('본인의 예약만 취소할 수 있습니다.');
      case 'already_cancelled':
        return failureResponse('이미 취소된 예약입니다.');
      case 'success':
        return successResponse(result.appointment);
    }
  },
});
