interface TokenRequest {
  roomName: string;
  participantName: string;
}

export async function fetchLivekitToken(request: TokenRequest): Promise<string> {
  const response = await fetch('/livekit/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`토큰 발급 실패: ${response.status}`);
  }

  const data: { token: string } = await response.json();
  return data.token;
}
