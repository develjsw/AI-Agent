import { prisma } from '../prisma.js';

const EARTH_RADIUS_KM = 6371;

interface HospitalSearchParams {
  departmentName?: string;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
}

export class HospitalService {
  async search(params: HospitalSearchParams) {
    const hospitals = await prisma.hospital.findMany({
      where: this.buildSearchWhere(params.departmentName),
      include: { departments: { include: { department: true } } },
    });

    if (params.latitude === undefined || params.longitude === undefined) {
      return hospitals;
    }

    const userLatitude = params.latitude;
    const userLongitude = params.longitude;
    return hospitals.filter((hospital) => {
      const distance = this.calculateDistanceKm(
        userLatitude,
        userLongitude,
        hospital.latitude,
        hospital.longitude,
      );
      return distance <= params.radiusKm;
    });
  }

  async getDetail(hospitalId: number) {
    return prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        departments: { include: { department: true } },
        waitings: { include: { department: true } },
      },
    });
  }

  async getWaitingStatus(hospitalId: number, departmentName: string) {
    return prisma.waitingStatus.findFirst({
      where: {
        hospitalId,
        department: { name: { contains: departmentName } },
      },
      include: { department: true, hospital: true },
    });
  }

  private buildSearchWhere(departmentName?: string) {
    if (!departmentName) return undefined;
    return {
      departments: { some: { department: { name: { contains: departmentName } } } },
    };
  }

  private calculateDistanceKm(
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
}

export const hospitalService = new HospitalService();
