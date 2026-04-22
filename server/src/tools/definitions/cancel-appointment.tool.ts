import { AppointmentService } from '../../appointment/appointment.service';
import { AgentTool } from '../agent-tool.interface';

export const createCancelAppointmentTool = (appointmentService: AppointmentService): AgentTool => ({
  name: 'cancel_appointment',
  description: '예약 ID와 환자 ID로 예약을 취소합니다.',
  parameters: {
    type: 'object',
    properties: {
      appointmentId: { type: 'number', description: '취소할 예약 ID' },
      userId: { type: 'number', description: '환자 ID' },
    },
    required: ['appointmentId', 'userId'],
  },
  execute: async (args) => {
    try {
      const appointment = await appointmentService.cancelAppointment(
        args.appointmentId as number,
        args.userId as number,
      );
      return JSON.stringify(appointment);
    } catch (error) {
      return error instanceof Error ? error.message : '예약 취소에 실패했습니다.';
    }
  },
});
