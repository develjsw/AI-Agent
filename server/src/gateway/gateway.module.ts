import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { AppGateway } from './app.gateway';

@Module({
  imports: [AgentModule],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
