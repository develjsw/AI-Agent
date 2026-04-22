import { AppointmentService } from '../../appointment/appointment.service';
import { AgentTool } from '../agent-tool.interface';

export const createCreateAppointmentTool = (appointmentService: AppointmentService): AgentTool => ({
  name: 'create_appointment',
  description: '의사와 날짜/시간을 지정하여 진료 예약을 생성합니다.',
  parameters: {
    type: 'object',
    properties: {
      userId: { type: 'number', description: '환자 ID' },
      doctorId: { type: 'number', description: '의사 ID' },
      scheduledAt: {
        type: 'string',
        description: '예약 일시 (ISO 8601 형식, 예: 2026-04-25T10:00:00)',
      },
      note: { type: 'string', description: '증상 또는 요청 사항' },
    },
    required: ['userId', 'doctorId', 'scheduledAt'],
  },
  execute: async (args) => {
    try {
      const appointment = await appointmentService.createAppointment({
        userId: args.userId as number,
        doctorId: args.doctorId as number,
        scheduledAt: new Date(args.scheduledAt as string),
        note: args.note as string | undefined,
      });
      return JSON.stringify(appointment);
    } catch (error) {
      return error instanceof Error ? error.message : '예약 생성에 실패했습니다.';
    }
  },
});
