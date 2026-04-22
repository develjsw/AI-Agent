const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export interface TokenRequest {
  roomName: string;
  participantName: string;
}

export interface TokenResponse {
  token: string;
}

export async function fetchLivekitToken(request: TokenRequest): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/livekit/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`토큰 발급 실패: ${response.status}`);
  }

  const data = (await response.json()) as TokenResponse;
  return data.token;
}
