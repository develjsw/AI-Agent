import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { logger } from "@/shared/index.js";

const ATLASSIAN_MCP_URL = "https://mcp.atlassian.com/v1/mcp/authv2";
const REDIRECT_HOST = "127.0.0.1";
const REDIRECT_PORT = 13123;
const REDIRECT_PATH = "/callback";
const REDIRECT_URL = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const CLIENT_NAME = "ai-agent-internal-knowledge";
const CLIENT_VERSION = "0.0.0";

interface AuthFiles {
  client: string;
  tokens: string;
  codeVerifier: string;
}

class FileAuthProvider implements OAuthClientProvider {
  constructor(private readonly files: AuthFiles) {}

  get redirectUrl(): string {
    return REDIRECT_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    return readJson<OAuthClientInformationFull>(this.files.client);
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await writeJson(this.files.client, info);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return readJson<OAuthTokens>(this.files.tokens);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await writeJson(this.files.tokens, tokens);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await writeJson(this.files.codeVerifier, { codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const stored = await readJson<{ codeVerifier: string }>(this.files.codeVerifier);
    if (!stored) {
      throw new Error("PKCE code verifier 누락 — 인증 흐름이 중단되었거나 상태 파일이 손상됨");
    }
    return stored.codeVerifier;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    // 브라우저 자동 실행은 OS 분기 부담이 있으므로 콘솔 안내. 사용자가 직접 열기
    logger.info({ url: url.toString() }, "OAuth 인증 URL 발급");
    console.log("\n아래 URL을 브라우저에서 열어 Atlassian 계정으로 인증해주세요:\n");
    console.log("  " + url.toString() + "\n");
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

interface CallbackServerHandle {
  codePromise: Promise<string>;
  close: () => Promise<void>;
}

function startCallbackServer(): CallbackServerHandle {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url) {
      respondPlain(res, 400, "missing url");
      return;
    }
    const url = new URL(req.url, REDIRECT_URL);
    if (url.pathname !== REDIRECT_PATH) {
      respondPlain(res, 404, "not found");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      const description = url.searchParams.get("error_description") ?? "";
      respondPlain(res, 400, `OAuth 오류: ${error} ${description}`);
      rejectCode(new Error(`OAuth 인증 실패: ${error} ${description}`.trim()));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      respondPlain(res, 400, "code 파라미터가 없습니다");
      rejectCode(new Error("OAuth callback에 authorization code가 없음"));
      return;
    }
    respondPlain(res, 200, "인증 완료. 이 창은 닫아도 됩니다.");
    resolveCode(code);
  };

  const server: Server = createServer(handle);
  server.listen(REDIRECT_PORT, REDIRECT_HOST);

  const timeout = setTimeout(() => {
    rejectCode(new Error(`OAuth callback 타임아웃 (${AUTH_TIMEOUT_MS / 1000}s)`));
  }, AUTH_TIMEOUT_MS);
  timeout.unref();

  return {
    codePromise,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timeout);
        server.close(() => resolve());
      }),
  };
}

function respondPlain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

export interface AtlassianMcpClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
}

export interface AtlassianMcpClientOptions {
  authDir?: string;
}

export async function createAtlassianMcpClient(
  opts: AtlassianMcpClientOptions = {},
): Promise<AtlassianMcpClient> {
  const authDir = opts.authDir ?? join(process.cwd(), "data", "auth", "atlassian");
  const provider = new FileAuthProvider({
    client: join(authDir, "client.json"),
    tokens: join(authDir, "tokens.json"),
    codeVerifier: join(authDir, "code-verifier.json"),
  });

  const transport = new StreamableHTTPClientTransport(new URL(ATLASSIAN_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION }, { capabilities: {} });

  try {
    await client.connect(transport);
    return wrap(client, transport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
  }

  logger.info("OAuth 인증 필요 — loopback 콜백 서버 시작");
  const callback = startCallbackServer();
  try {
    const code = await callback.codePromise;
    await transport.finishAuth(code);
  } finally {
    await callback.close();
  }

  await client.connect(transport);
  logger.info("Atlassian MCP 연결 성공");
  return wrap(client, transport);
}

function wrap(client: Client, transport: StreamableHTTPClientTransport): AtlassianMcpClient {
  return {
    client,
    transport,
    close: () => client.close(),
  };
}
