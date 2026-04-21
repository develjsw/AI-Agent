import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AgentService } from '../agent/agent.service';

interface UserMessagePayload {
  sessionId: string;
  message: string;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly agentService: AgentService) {}

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.agentService.clearHistory(client.id);
  }

  @SubscribeMessage('user-message')
  async handleUserMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UserMessagePayload,
  ) {
    const sessionId = payload.sessionId ?? client.id;

    try {
      const response = await this.agentService.processMessage(sessionId, payload.message);
      client.emit('agent-response', { sessionId, text: response });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '처리 중 오류가 발생했습니다.';
      client.emit('agent-error', { sessionId, message: errorMessage });
    }
  }

  @SubscribeMessage('leave-session')
  handleLeaveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { sessionId: string },
  ) {
    const sessionId = payload.sessionId ?? client.id;
    this.agentService.clearHistory(sessionId);
    client.emit('session-cleared', { sessionId });
  }

  emitToolResult(clientId: string, toolName: string, result: unknown) {
    this.server.to(clientId).emit('tool-result', { toolName, result });
  }
}
