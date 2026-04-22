import { HospitalService } from '../../hospital/hospital.service';
import { AgentTool } from '../agent-tool.interface';

export const createCheckWaitingStatusTool = (hospitalService: HospitalService): AgentTool => ({
  name: 'check_waiting_status',
  description: '특정 병원의 진료과 현재 대기 인원과 예상 대기 시간을 조회합니다.',
  parameters: {
    type: 'object',
    properties: {
      hospitalId: { type: 'number', description: '병원 ID' },
      departmentName: { type: 'string', description: '진료과 이름 (예: 내과, 외과)' },
    },
    required: ['hospitalId', 'departmentName'],
  },
  execute: async (args) => {
    const status = await hospitalService.checkWaitingStatus(
      args.hospitalId as number,
      args.departmentName as string,
    );
    if (!status) return '해당 진료과의 대기 정보를 찾을 수 없습니다.';
    return JSON.stringify(status);
  },
});
