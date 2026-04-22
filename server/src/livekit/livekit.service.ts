import { Injectable } from '@nestjs/common';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';

const AGENT_NAME = 'hospital-voice';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`환경변수 ${key}가 설정되지 않았습니다.`);
  }
  return value;
}

@Injectable()
export class LivekitService {
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    this.apiKey = requireEnv('LIVEKIT_API_KEY');
    this.apiSecret = requireEnv('LIVEKIT_API_SECRET');
  }

  async generateToken(roomName: string, participantName: string): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participantName,
    });

    token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });

    return token.toJwt();
  }
}
