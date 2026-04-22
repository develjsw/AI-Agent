import { useCallback, useEffect, useRef, useState } from 'react';
import { ParticipantKind, Room, RoomEvent } from 'livekit-client';
import { fetchLivekitToken } from '../api/livekit-token';

export const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 1500;

export type VoiceSessionStatus =
  | { type: 'idle' }
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'error'; message: string };

interface VoiceSessionOptions {
  userId: number;
  displayName: string;
}

function getLivekitUrl(): string {
  const url = import.meta.env.VITE_LIVEKIT_URL;
  if (!url) {
    throw new Error(
      'VITE_LIVEKIT_URL이 설정되지 않았습니다. 루트 .env에 추가해주세요.',
    );
  }
  return url;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류가 발생했습니다.';
}

export function useVoiceSession({ userId, displayName }: VoiceSessionOptions) {
  const [status, setStatus] = useState<VoiceSessionStatus>({ type: 'idle' });
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalDisconnectRef = useRef(false);

  const startSession = useCallback(async () => {
    intentionalDisconnectRef.current = false;
    try {
      const token = await fetchLivekitToken({
        roomName: `voice-${userId}`,
        participantName: displayName,
      });

      const newRoom = new Room({ adaptiveStream: true, dynacast: true });

      newRoom.on(RoomEvent.Disconnected, () => {
        setRoom(null);
        setMicrophoneEnabled(false);
        setStatus((prev) => {
          if (prev.type === 'reconnecting') return prev;
          return { type: 'idle' };
        });
      });

      newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.kind !== ParticipantKind.AGENT) return;
        if (intentionalDisconnectRef.current) return;

        const nextAttempt = reconnectAttemptRef.current + 1;
        if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
          setStatus({
            type: 'error',
            message: '에이전트와 연결이 끊어졌고 재연결도 실패했습니다.',
          });
          void newRoom.disconnect();
          return;
        }
        reconnectAttemptRef.current = nextAttempt;
        setStatus({ type: 'reconnecting', attempt: nextAttempt });
        void newRoom.disconnect();
        reconnectTimerRef.current = setTimeout(() => {
          void startSession();
        }, RECONNECT_DELAY_MS);
      });

      await newRoom.connect(getLivekitUrl(), token);
      await newRoom.localParticipant.setMicrophoneEnabled(true);

      setRoom(newRoom);
      setMicrophoneEnabled(true);
      setStatus({ type: 'connected' });
      reconnectAttemptRef.current = 0;
    } catch (error) {
      setStatus({ type: 'error', message: getErrorMessage(error) });
    }
  }, [userId, displayName]);

  const connect = useCallback(() => {
    if (
      status.type === 'connecting' ||
      status.type === 'connected' ||
      status.type === 'reconnecting'
    ) {
      return;
    }
    reconnectAttemptRef.current = 0;
    setStatus({ type: 'connecting' });
    void startSession();
  }, [status.type, startSession]);

  const disconnect = useCallback(async () => {
    if (!room) return;
    intentionalDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    await room.disconnect();
  }, [room]);

  const toggleMicrophone = useCallback(async () => {
    if (!room) return;
    const next = !microphoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicrophoneEnabled(next);
  }, [room, microphoneEnabled]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (room) room.disconnect();
    };
  }, [room]);

  return { status, microphoneEnabled, room, connect, disconnect, toggleMicrophone };
}
