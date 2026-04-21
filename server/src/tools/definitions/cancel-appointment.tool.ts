import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { AppointmentService } from '../../appointment/appointment.service';

export const createCancelAppointmentTool = (appointmentService: AppointmentService) =>
  tool(
    async ({ appointmentId, userId }) => {
      try {
        const appointment = await appointmentService.cancelAppointment(appointmentId, userId);
        return JSON.stringify(appointment);
      } catch (error) {
        return error instanceof Error ? error.message : '예약 취소에 실패했습니다.';
      }
    },
    {
      name: 'cancel_appointment',
      description: '예약 ID와 환자 ID로 예약을 취소합니다.',
      schema: z.object({
        appointmentId: z.number().describe('취소할 예약 ID'),
        userId: z.number().describe('환자 ID'),
      }),
    },
  );
