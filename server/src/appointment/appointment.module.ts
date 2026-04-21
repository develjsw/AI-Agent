import { Module } from '@nestjs/common';
import { AppointmentService } from './appointment.service';

@Module({
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
