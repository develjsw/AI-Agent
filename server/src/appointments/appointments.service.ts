import { Injectable } from '@nestjs/common';
import { AppointmentStatus } from '../../../prisma/generated';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: number, status?: AppointmentStatus) {
    return this.prisma.appointment.findMany({
      where: this.buildWhere(userId, status),
      include: { doctor: { include: { hospital: true, department: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  private buildWhere(userId: number, status?: AppointmentStatus) {
    if (!status) return { userId };
    return { userId, status };
  }
}
