import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HospitalService } from '../../hospital/hospital.service';

export const createGetHospitalDetailTool = (hospitalService: HospitalService) =>
  tool(
    async ({ hospitalId }) => {
      const hospital = await hospitalService.getHospitalDetail(hospitalId);

      if (!hospital) {
        return '해당 병원을 찾을 수 없습니다.';
      }

      return JSON.stringify(hospital);
    },
    {
      name: 'get_hospital_detail',
      description: '병원 ID로 병원 상세 정보(운영시간, 전화번호, 진료과, 대기현황)를 조회합니다.',
      schema: z.object({
        hospitalId: z.number().describe('병원 ID'),
      }),
    },
  );
