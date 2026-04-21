import { Injectable } from '@nestjs/common';
import { StructuredToolInterface } from '@langchain/core/tools';
import { HospitalService } from '../hospital/hospital.service';
import { AppointmentService } from '../appointment/appointment.service';
import { PrismaService } from '../prisma/prisma.service';
import { createSearchHospitalsTool } from './definitions/search-hospitals.tool';
import { createGetHospitalDetailTool } from './definitions/get-hospital-detail.tool';
import { createCheckWaitingStatusTool } from './definitions/check-waiting-status.tool';
import { createRecommendDepartmentTool } from './definitions/recommend-department.tool';
import { createCreateAppointmentTool } from './definitions/create-appointment.tool';
import { createCancelAppointmentTool } from './definitions/cancel-appointment.tool';
import { createGetMyAppointmentsTool } from './definitions/get-my-appointments.tool';

@Injectable()
export class ToolRegistryService {
  readonly tools: StructuredToolInterface[];

  constructor(
    private readonly hospitalService: HospitalService,
    private readonly appointmentService: AppointmentService,
    private readonly prisma: PrismaService,
  ) {
    this.tools = [
      createSearchHospitalsTool(this.hospitalService),
      createGetHospitalDetailTool(this.hospitalService),
      createCheckWaitingStatusTool(this.hospitalService),
      createRecommendDepartmentTool(this.prisma),
      createCreateAppointmentTool(this.appointmentService),
      createCancelAppointmentTool(this.appointmentService),
      createGetMyAppointmentsTool(this.appointmentService),
    ];
  }
}
