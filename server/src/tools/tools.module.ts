import { Module } from '@nestjs/common';
import { HospitalModule } from '../hospital/hospital.module';
import { AppointmentModule } from '../appointment/appointment.module';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [HospitalModule, AppointmentModule],
  providers: [ToolRegistryService],
  exports: [ToolRegistryService],
})
export class ToolsModule {}
