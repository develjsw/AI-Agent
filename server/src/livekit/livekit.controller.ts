import { Controller, Post, Body } from '@nestjs/common';
import { LivekitService } from './livekit.service';

interface GenerateTokenBody {
  roomName: string;
  participantName: string;
}

@Controller('livekit')
export class LivekitController {
  constructor(private readonly livekitService: LivekitService) {}

  @Post('token')
  async generateToken(@Body() body: GenerateTokenBody) {
    const token = await this.livekitService.generateToken(
      body.roomName,
      body.participantName,
    );
    return { token };
  }
}
