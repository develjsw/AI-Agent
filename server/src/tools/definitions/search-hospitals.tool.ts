import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { HospitalService } from '../../hospital/hospital.service';

export const createSearchHospitalsTool = (hospitalService: HospitalService) =>
  tool(
    async ({ departmentName, latitude, longitude, radiusKm }) => {
      const hospitals = await hospitalService.searchHospitals({
        departmentName,
        latitude,
        longitude,
        radiusKm,
      });

      if (hospitals.length === 0) {
        return '조건에 맞는 병원을 찾을 수 없습니다.';
      }

      return JSON.stringify(hospitals);
    },
    {
      name: 'search_hospitals',
      description:
        '진료과명 또는 위치(위경도 + 반경)로 병원을 검색합니다. 진료과명, 위도, 경도, 반경(km) 중 하나 이상을 입력하세요.',
      schema: z.object({
        departmentName: z.string().optional().describe('진료과 이름 (예: 내과, 신경과)'),
        latitude: z.number().optional().describe('사용자 위도'),
        longitude: z.number().optional().describe('사용자 경도'),
        radiusKm: z.number().optional().default(5).describe('검색 반경 (km, 기본값: 5)'),
      }),
    },
  );
