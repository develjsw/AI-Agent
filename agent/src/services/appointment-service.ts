import { prisma } from '../prisma.js';
import { AppointmentStatus } from '../../prisma/generated/index.js';

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

export interface CreateAppointmentInput {
  userId: number;
  doctorId: number;
  scheduledAt: Date;
  note?: string;
}

export type CancelAppointmentResult =
  | { type: 'success'; appointment: Awaited<ReturnType<AppointmentService['cancelById']>> }
  | { type: 'not_found' }
  | { type: 'forbidden' }
  | { type: 'already_cancelled' };

export type CreateAppointmentResult =
  | { type: 'success'; appointment: Awaited<ReturnType<AppointmentService['createNew']>> }
  | { type: 'conflict' };

export class AppointmentService {
  async create(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
    const conflict = await this.findConflict(input.doctorId, input.scheduledAt);
    if (conflict) return { type: 'conflict' };

    const appointment = await this.createNew(input);
    return { type: 'success', appointment };
  }

  async cancel(appointmentId: number, userId: number): Promise<CancelAppointmentResult> {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appointment) return { type: 'not_found' };
    if (appointment.userId !== userId) return { type: 'forbidden' };
    if (appointment.status === AppointmentStatus.CANCELLED) return { type: 'already_cancelled' };

    const cancelled = await this.cancelById(appointmentId);
    return { type: 'success', appointment: cancelled };
  }

  async listByUser(userId: number, status?: AppointmentStatus) {
    return prisma.appointment.findMany({
      where: this.buildListWhere(userId, status),
      include: { doctor: { include: { hospital: true, department: true } } },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  private async findConflict(doctorId: number, scheduledAt: Date) {
    return prisma.appointment.findFirst({
      where: {
        doctorId,
        scheduledAt,
        status: { in: ACTIVE_STATUSES },
      },
    });
  }

  private async createNew(input: CreateAppointmentInput) {
    return prisma.appointment.create({
      data: {
        userId: input.userId,
        doctorId: input.doctorId,
        scheduledAt: input.scheduledAt,
        note: input.note,
      },
      include: {
        doctor: { include: { hospital: true, department: true } },
        user: true,
      },
    });
  }

  private async cancelById(appointmentId: number) {
    return prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.CANCELLED },
      include: { doctor: { include: { hospital: true } } },
    });
  }

  private buildListWhere(userId: number, status?: AppointmentStatus) {
    if (!status) return { userId };
    return { userId, status };
  }
}

export const appointmentService = new AppointmentService();
