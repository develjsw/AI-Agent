import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HospitalService } from '../../hospital/hospital.service';

export const createCheckWaitingStatusTool = (hospitalService: HospitalService) =>
  tool(
    async ({ hospitalId, departmentName }) => {
      const status = await hospitalService.checkWaitingStatus(hospitalId, departmentName);

      if (!status) {
        return '해당 진료과의 대기 정보를 찾을 수 없습니다.';
      }

      return JSON.stringify(status);
    },
    {
      name: 'check_waiting_status',
      description: '특정 병원의 진료과 현재 대기 인원과 예상 대기 시간을 조회합니다.',
      schema: z.object({
        hospitalId: z.number().describe('병원 ID'),
        departmentName: z.string().describe('진료과 이름 (예: 내과, 외과)'),
      }),
    },
  );
