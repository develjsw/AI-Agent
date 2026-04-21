import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentService } from '../../appointment/appointment.service';

export const createGetMyAppointmentsTool = (appointmentService: AppointmentService) =>
  tool(
    async ({ userId, status }) => {
      const appointments = await appointmentService.getMyAppointments(
        userId,
        status as AppointmentStatus | undefined,
      );

      if (appointments.length === 0) {
        return '예약 내역이 없습니다.';
      }

      return JSON.stringify(appointments);
    },
    {
      name: 'get_my_appointments',
      description: '환자의 예약 목록을 조회합니다. 상태(PENDING, CONFIRMED, CANCELLED, COMPLETED)로 필터링 가능합니다.',
      schema: z.object({
        userId: z.number().describe('환자 ID'),
        status: z
          .enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])
          .optional()
          .describe('예약 상태 필터'),
      }),
    },
  );
