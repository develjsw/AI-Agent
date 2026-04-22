import { useCallback, useEffect, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { fetchLivekitToken } from '../api/livekit-token';

function getLivekitUrl(): string {
  const url = import.meta.env.VITE_LIVEKIT_URL;
  if (!url) {
    throw new Error(
      'VITE_LIVEKIT_URL이 설정되지 않았습니다. 루트 .env에 추가해주세요.',
    );
  }
  return url;
}

export type VoiceSessionStatus =
  | { type: 'idle' }
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'error'; message: string };

interface VoiceSessionOptions {
  userId: number;
  displayName: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '알 수 없는 오류가 발생했습니다.';
}

export function useVoiceSession({ userId, displayName }: VoiceSessionOptions) {
  const [status, setStatus] = useState<VoiceSessionStatus>({ type: 'idle' });
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);

  const connect = useCallback(async () => {
    if (status.type === 'connecting' || status.type === 'connected') return;

    setStatus({ type: 'connecting' });
    try {
      const token = await fetchLivekitToken({
        roomName: `voice-${userId}`,
        participantName: displayName,
      });

      const newRoom = new Room({ adaptiveStream: true, dynacast: true });
      newRoom.on(RoomEvent.Disconnected, () => {
        setRoom(null);
        setMicrophoneEnabled(false);
        setStatus({ type: 'idle' });
      });

      await newRoom.connect(getLivekitUrl(), token);
      await newRoom.localParticipant.setMicrophoneEnabled(true);

      setRoom(newRoom);
      setMicrophoneEnabled(true);
      setStatus({ type: 'connected' });
    } catch (error) {
      setStatus({ type: 'error', message: getErrorMessage(error) });
    }
  }, [userId, displayName, status.type]);

  const disconnect = useCallback(async () => {
    if (!room) return;
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
      if (room) room.disconnect();
    };
  }, [room]);

  return { status, microphoneEnabled, room, connect, disconnect, toggleMicrophone };
}
