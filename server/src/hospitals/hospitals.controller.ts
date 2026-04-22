import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { HospitalsService } from './hospitals.service';

@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  findAll(@Query('departmentName') departmentName?: string) {
    return this.hospitalsService.findAll(departmentName);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hospitalsService.findOne(id);
  }
}
