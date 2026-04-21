import { Injectable } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

@Injectable()
export class LivekitService {
  private readonly apiKey = process.env.LIVEKIT_API_KEY!;
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET!;
  private readonly livekitUrl = process.env.LIVEKIT_URL!;

  private readonly roomService = new RoomServiceClient(
    this.livekitUrl,
    this.apiKey,
    this.apiSecret,
  );

  async generateToken(roomName: string, participantName: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participantName,
    });

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    return token.toJwt();
  }

  async listParticipants(roomName: string) {
    return this.roomService.listParticipants(roomName);
  }

  async deleteRoom(roomName: string): Promise<void> {
    await this.roomService.deleteRoom(roomName);
  }
}
