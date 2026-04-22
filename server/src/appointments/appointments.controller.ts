import { Controller, Get, ParseEnumPipe, ParseIntPipe, Query } from '@nestjs/common';
import { AppointmentStatus } from '../../../prisma/generated';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  findByUser(
    @Query('userId', ParseIntPipe) userId: number,
    @Query('status', new ParseEnumPipe(AppointmentStatus, { optional: true }))
    status?: AppointmentStatus,
  ) {
    return this.appointmentsService.findByUser(userId, status);
  }
}
