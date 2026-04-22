import { Injectable } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class LivekitService {
  private readonly apiKey = process.env.LIVEKIT_API_KEY!;
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET!;

  async generateToken(roomName: string, participantName: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participantName,
    });

    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    return token.toJwt();
  }
}
