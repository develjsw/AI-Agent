import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HospitalService {
  constructor(private readonly prisma: PrismaService) {}

  async searchHospitals(params: {
    departmentName?: string;
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
  }) {
    const { departmentName, latitude, longitude, radiusKm = 5 } = params;

    const hospitals = await this.prisma.hospital.findMany({
      where: departmentName
        ? {
            departments: {
              some: { department: { name: { contains: departmentName } } },
            },
          }
        : undefined,
      include: {
        departments: { include: { department: true } },
      },
    });

    if (latitude && longitude) {
      return hospitals.filter((hospital) => {
        const distanceKm = this.calculateDistanceKm(
          latitude,
          longitude,
          hospital.latitude,
          hospital.longitude,
        );
        return distanceKm <= radiusKm;
      });
    }

    return hospitals;
  }

  async getHospitalDetail(hospitalId: number) {
    return this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        departments: { include: { department: true } },
        waitings: { include: { department: true } },
      },
    });
  }

  async checkWaitingStatus(hospitalId: number, departmentName: string) {
    return this.prisma.waitingStatus.findFirst({
      where: {
        hospitalId,
        department: { name: { contains: departmentName } },
      },
      include: { department: true, hospital: true },
    });
  }

  // Haversine 공식으로 두 좌표 간 거리(km) 계산
  private calculateDistanceKm(
    userLatitude: number,
    userLongitude: number,
    hospitalLatitude: number,
    hospitalLongitude: number,
  ): number {
    const earthRadiusKm = 6371;
    const deltaLatitude = this.toRadians(hospitalLatitude - userLatitude);
    const deltaLongitude = this.toRadians(hospitalLongitude - userLongitude);
    const haversine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(this.toRadians(userLatitude)) *
        Math.cos(this.toRadians(hospitalLatitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
