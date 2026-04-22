import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LivekitModule } from './livekit/livekit.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    LivekitModule,
  ],
})
export class AppModule {}
