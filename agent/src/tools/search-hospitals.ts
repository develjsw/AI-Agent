import { llm } from '@livekit/agents';
import { z } from 'zod';
import { prisma } from '../prisma.js';

const EARTH_RADIUS_KM = 6371;

function calculateDistanceKm(
  userLatitude: number,
  userLongitude: number,
  hospitalLatitude: number,
  hospitalLongitude: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLatitude = toRadians(hospitalLatitude - userLatitude);
  const deltaLongitude = toRadians(hospitalLongitude - userLongitude);

  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(userLatitude)) *
      Math.cos(toRadians(hospitalLatitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export const searchHospitalsTool = llm.tool({
  description:
    '진료과명 또는 위치(위경도 + 반경)로 병원을 검색합니다. 진료과명, 위도, 경도, 반경(km) 중 하나 이상을 입력하세요.',
  parameters: z.object({
    departmentName: z.string().optional().describe('진료과 이름 (예: 내과, 신경과)'),
    latitude: z.number().optional().describe('사용자 위도'),
    longitude: z.number().optional().describe('사용자 경도'),
    radiusKm: z.number().optional().default(5).describe('검색 반경 (km, 기본값: 5)'),
  }),
  execute: async ({ departmentName, latitude, longitude, radiusKm = 5 }) => {
    const hospitals = await prisma.hospital.findMany({
      where: departmentName
        ? { departments: { some: { department: { name: { contains: departmentName } } } } }
        : undefined,
      include: { departments: { include: { department: true } } },
    });

    const filtered =
      latitude && longitude
        ? hospitals.filter(
            (hospital) =>
              calculateDistanceKm(latitude, longitude, hospital.latitude, hospital.longitude) <=
              radiusKm,
          )
        : hospitals;

    if (filtered.length === 0) return '조건에 맞는 병원을 찾을 수 없습니다.';
    return JSON.stringify(filtered);
  },
});
