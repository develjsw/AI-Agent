import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { AppointmentService } from '../../appointment/appointment.service';

export const createCreateAppointmentTool = (appointmentService: AppointmentService) =>
  tool(
    async ({ userId, doctorId, scheduledAt, note }) => {
      try {
        const appointment = await appointmentService.createAppointment({
          userId,
          doctorId,
          scheduledAt: new Date(scheduledAt),
          note,
        });
        return JSON.stringify(appointment);
      } catch (error) {
        return error instanceof Error ? error.message : '예약 생성에 실패했습니다.';
      }
    },
    {
      name: 'create_appointment',
      description: '의사와 날짜/시간을 지정하여 진료 예약을 생성합니다.',
      schema: z.object({
        userId: z.number().describe('환자 ID'),
        doctorId: z.number().describe('의사 ID'),
        scheduledAt: z.string().describe('예약 일시 (ISO 8601 형식, 예: 2026-04-25T10:00:00)'),
        note: z.string().optional().describe('증상 또는 요청 사항'),
      }),
    },
  );
