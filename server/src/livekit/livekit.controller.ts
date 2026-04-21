import { Controller, Post, Body } from '@nestjs/common';
import { LivekitService } from './livekit.service';

class GenerateTokenDto {
  roomName: string;
  participantName: string;
}

@Controller('livekit')
export class LivekitController {
  constructor(private readonly livekitService: LivekitService) {}

  @Post('token')
  async generateToken(@Body() body: GenerateTokenDto) {
    const token = await this.livekitService.generateToken(
      body.roomName,
      body.participantName,
    );
    return { token };
  }
}
