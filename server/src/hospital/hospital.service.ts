import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_KM = 6371;

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

    const where: Prisma.HospitalWhereInput = {};
    if (departmentName) {
      where.departments = {
        some: { department: { name: { contains: departmentName } } },
      };
    }

    const hospitals = await this.prisma.hospital.findMany({
      where,
      include: {
        departments: { include: { department: true } },
      },
    });

    if (!latitude || !longitude) {
      return hospitals;
    }

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
    const userLatRad = this.toRadians(userLatitude);
    const hospitalLatRad = this.toRadians(hospitalLatitude);
    const deltaLatRad = this.toRadians(hospitalLatitude - userLatitude);
    const deltaLonRad = this.toRadians(hospitalLongitude - userLongitude);

    const sinHalfDeltaLat = Math.sin(deltaLatRad / 2);
    const sinHalfDeltaLon = Math.sin(deltaLonRad / 2);

    const haversine =
      sinHalfDeltaLat * sinHalfDeltaLat +
      Math.cos(userLatRad) * Math.cos(hospitalLatRad) * sinHalfDeltaLon * sinHalfDeltaLon;

    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
