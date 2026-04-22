import { llm } from '@livekit/agents';
import { z } from 'zod';
import { prisma } from '../prisma.js';

const EARTH_RADIUS_KM = 6371;

function calcDistanceKm(
  userLat: number,
  userLon: number,
  hospLat: number,
  hospLon: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(hospLat - userLat);
  const dLon = toRad(hospLon - userLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(userLat)) * Math.cos(toRad(hospLat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
            (h) => calcDistanceKm(latitude, longitude, h.latitude, h.longitude) <= radiusKm,
          )
        : hospitals;

    if (filtered.length === 0) return '조건에 맞는 병원을 찾을 수 없습니다.';
    return JSON.stringify(filtered);
  },
});
