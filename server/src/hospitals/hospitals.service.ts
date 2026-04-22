import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HospitalsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(departmentName?: string) {
    return this.prisma.hospital.findMany({
      where: this.buildDepartmentFilter(departmentName),
      include: { departments: { include: { department: true } } },
    });
  }

  async findOne(hospitalId: number) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: {
        departments: { include: { department: true } },
        waitings: { include: { department: true } },
      },
    });
    if (!hospital) throw new NotFoundException('해당 병원을 찾을 수 없습니다.');
    return hospital;
  }

  private buildDepartmentFilter(departmentName?: string) {
    if (!departmentName) return undefined;
    return {
      departments: { some: { department: { name: { contains: departmentName } } } },
    };
  }
}
