import { Injectable } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppointmentService {
  constructor(private readonly prisma: PrismaService) {}

  async createAppointment(params: {
    userId: number;
    doctorId: number;
    scheduledAt: Date;
    note?: string;
  }) {
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        doctorId: params.doctorId,
        scheduledAt: params.scheduledAt,
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED] },
      },
    });

    if (conflict) {
      throw new Error('해당 시간에 이미 예약이 존재합니다.');
    }

    return this.prisma.appointment.create({
      data: params,
      include: {
        doctor: { include: { hospital: true, department: true } },
        user: true,
      },
    });
  }

  async cancelAppointment(appointmentId: number, userId: number) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new Error('예약을 찾을 수 없습니다.');
    }
    if (appointment.userId !== userId) {
      throw new Error('본인의 예약만 취소할 수 있습니다.');
    }
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new Error('이미 취소된 예약입니다.');
    }

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED },
      include: { doctor: { include: { hospital: true } } },
    });
  }

  async getMyAppointments(userId: number, status?: AppointmentStatus) {
    return this.prisma.appointment.findMany({
      where: { userId, ...(status && { status }) },
      include: {
        doctor: { include: { hospital: true, department: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async getAvailableDoctors(hospitalId: number, departmentName: string) {
    return this.prisma.doctor.findMany({
      where: {
        hospitalId,
        department: { name: { contains: departmentName } },
      },
      include: { department: true },
    });
  }
}
