import { HospitalService } from '../../hospital/hospital.service';
import { AgentTool } from '../agent-tool.interface';

export const createGetHospitalDetailTool = (hospitalService: HospitalService): AgentTool => ({
  name: 'get_hospital_detail',
  description: '병원 ID로 병원 상세 정보(운영시간, 전화번호, 진료과, 대기현황)를 조회합니다.',
  parameters: {
    type: 'object',
    properties: {
      hospitalId: { type: 'number', description: '병원 ID' },
    },
    required: ['hospitalId'],
  },
  execute: async (args) => {
    const hospital = await hospitalService.getHospitalDetail(args.hospitalId as number);
    if (!hospital) return '해당 병원을 찾을 수 없습니다.';
    return JSON.stringify(hospital);
  },
});
