import { HospitalService } from '../../hospital/hospital.service';
import { AgentTool } from '../agent-tool.interface';

export const createSearchHospitalsTool = (hospitalService: HospitalService): AgentTool => ({
  name: 'search_hospitals',
  description:
    '진료과명 또는 위치(위경도 + 반경)로 병원을 검색합니다. 진료과명, 위도, 경도, 반경(km) 중 하나 이상을 입력하세요.',
  parameters: {
    type: 'object',
    properties: {
      departmentName: { type: 'string', description: '진료과 이름 (예: 내과, 신경과)' },
      latitude: { type: 'number', description: '사용자 위도' },
      longitude: { type: 'number', description: '사용자 경도' },
      radiusKm: { type: 'number', description: '검색 반경 (km, 기본값: 5)' },
    },
  },
  execute: async (args) => {
    const { departmentName, latitude, longitude, radiusKm } = args as {
      departmentName?: string;
      latitude?: number;
      longitude?: number;
      radiusKm?: number;
    };

    const hospitals = await hospitalService.searchHospitals({
      departmentName,
      latitude,
      longitude,
      radiusKm,
    });

    if (hospitals.length === 0) return '조건에 맞는 병원을 찾을 수 없습니다.';
    return JSON.stringify(hospitals);
  },
});
