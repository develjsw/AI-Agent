import { Module } from '@nestjs/common';
import { HospitalService } from './hospital.service';

@Module({
  providers: [HospitalService],
  exports: [HospitalService],
})
export class HospitalModule {}
