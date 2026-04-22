import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import type { Room } from 'livekit-client';
import {
  MAX_RECONNECT_ATTEMPTS,
  useVoiceSession,
  type VoiceSessionStatus,
} from '../hooks/use-voice-session';
import styles from './voice-room.module.css';

const DEMO_USER_ID = 1;
const DEMO_DISPLAY_NAME = '홍길동';

export function VoiceRoom() {
  const session = useVoiceSession({
    userId: DEMO_USER_ID,
    displayName: DEMO_DISPLAY_NAME,
  });

  return (
    <main className={styles.layout}>
      <header className={styles.header}>
        <h1 className={styles.title}>병원 예약 어시스턴트</h1>
        <p className={styles.subtitle}>마이크를 켜고 자연스럽게 말해보세요</p>
      </header>

      <div className={styles.card}>
        <SessionView
          status={session.status}
          microphoneEnabled={session.microphoneEnabled}
          room={session.room}
          onConnect={session.connect}
          onDisconnect={session.disconnect}
          onToggleMicrophone={session.toggleMicrophone}
        />
      </div>
    </main>
  );
}

interface SessionViewProps {
  status: VoiceSessionStatus;
  microphoneEnabled: boolean;
  room: Room | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMicrophone: () => void;
}

function SessionView(props: SessionViewProps) {
  switch (props.status.type) {
    case 'idle':
      return (
        <button className={styles.primaryButton} onClick={props.onConnect}>
          음성 세션 시작
        </button>
      );
    case 'connecting':
      return <span className={styles.statusLabel}>연결 중...</span>;
    case 'reconnecting':
      return (
        <span className={styles.statusLabel}>
          재연결 중... ({props.status.attempt}/{MAX_RECONNECT_ATTEMPTS})
        </span>
      );
    case 'error':
      return (
        <>
          <p className={styles.errorMessage}>{props.status.message}</p>
          <button className={styles.primaryButton} onClick={props.onConnect}>
            다시 시도
          </button>
        </>
      );
    case 'connected':
      if (!props.room) return null;
      return (
        <RoomContext.Provider value={props.room}>
          <RoomAudioRenderer />
          <ConnectedControls
            microphoneEnabled={props.microphoneEnabled}
            onToggleMicrophone={props.onToggleMicrophone}
            onDisconnect={props.onDisconnect}
          />
        </RoomContext.Provider>
      );
  }
}

interface ConnectedControlsProps {
  microphoneEnabled: boolean;
  onToggleMicrophone: () => void;
  onDisconnect: () => void;
}

function ConnectedControls(props: ConnectedControlsProps) {
  const muted = !props.microphoneEnabled;
  let micClassName = styles.micButton;
  let micLabel = '켜짐';
  if (muted) {
    micClassName = `${styles.micButton} ${styles.muted}`;
    micLabel = '꺼짐';
  }

  return (
    <>
      <span className={styles.statusLabel}>연결됨</span>
      <button
        className={micClassName}
        onClick={props.onToggleMicrophone}
        aria-label="마이크 토글"
      >
        {micLabel}
      </button>
      <button className={styles.secondaryButton} onClick={props.onDisconnect}>
        세션 종료
      </button>
    </>
  );
}
