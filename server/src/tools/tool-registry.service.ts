import { Injectable } from '@nestjs/common';
import { HospitalService } from '../hospital/hospital.service';
import { AppointmentService } from '../appointment/appointment.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTool } from './agent-tool.interface';
import { createSearchHospitalsTool } from './definitions/search-hospitals.tool';
import { createGetHospitalDetailTool } from './definitions/get-hospital-detail.tool';
import { createCheckWaitingStatusTool } from './definitions/check-waiting-status.tool';
import { createRecommendDepartmentTool } from './definitions/recommend-department.tool';
import { createCreateAppointmentTool } from './definitions/create-appointment.tool';
import { createCancelAppointmentTool } from './definitions/cancel-appointment.tool';
import { createGetMyAppointmentsTool } from './definitions/get-my-appointments.tool';

@Injectable()
export class ToolRegistryService {
  readonly tools: AgentTool[];

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

  getTool(name: string): AgentTool {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }
}
