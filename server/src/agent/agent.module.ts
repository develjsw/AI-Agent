import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { AgentService } from './agent.service';

@Module({
  imports: [ToolsModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
