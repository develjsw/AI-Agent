import { AppointmentService } from '../../appointment/appointment.service';
import { AppointmentStatus } from '@prisma/client';
import { AgentTool } from '../agent-tool.interface';

export const createGetMyAppointmentsTool = (appointmentService: AppointmentService): AgentTool => ({
  name: 'get_my_appointments',
  description:
    '환자의 예약 목록을 조회합니다. 상태(PENDING, CONFIRMED, CANCELLED, COMPLETED)로 필터링 가능합니다.',
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'number', description: '환자 ID' },
      status: {
        type: 'string',
        description: '예약 상태 필터',
        enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
      },
    },
    required: ['userId'],
  },
  execute: async (args) => {
    const appointments = await appointmentService.getMyAppointments(
      args.userId as number,
      args.status as AppointmentStatus | undefined,
    );
    if (appointments.length === 0) return '예약 내역이 없습니다.';
    return JSON.stringify(appointments);
  },
});
