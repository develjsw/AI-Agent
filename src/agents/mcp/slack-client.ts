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
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { type Config, logger } from "@/shared/index.js";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
// 매니페스트에 등록한 redirect URL과 정확히 일치해야 함 (localhost)
const REDIRECT_HOST = "127.0.0.1";
const REDIRECT_PORT = 13124;
const REDIRECT_PATH = "/callback";
const REDIRECT_URL = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const CLIENT_NAME = "ai-agent-internal-knowledge-slack";
const CLIENT_VERSION = "0.0.0";

interface AuthFiles {
  tokens: string;
  codeVerifier: string;
}

interface SlackCredentials {
  clientId: string;
  clientSecret: string;
}

// 사전 등록(confidential) 방식 — Atlassian의 dynamic registration과 대비.
// saveClientInformation을 정의하지 않아 DCR 미사용을 명시
class PreRegisteredAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly files: AuthFiles,
    private readonly credentials: SlackCredentials,
  ) {}

  get redirectUrl(): string {
    return REDIRECT_URL;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation> {
    return {
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
    };
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
    logger.info({ url: url.toString() }, "Slack OAuth 인증 URL 발급");
    console.log("\n아래 URL을 브라우저에서 열어 Slack 계정으로 인증해주세요:\n");
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
      rejectCode(new Error(`Slack OAuth 인증 실패: ${error} ${description}`.trim()));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      respondPlain(res, 400, "code 파라미터가 없습니다");
      rejectCode(new Error("Slack OAuth callback에 authorization code가 없음"));
      return;
    }
    respondPlain(res, 200, "Slack 인증 완료. 이 창은 닫아도 됩니다.");
    resolveCode(code);
  };

  const server: Server = createServer(handle);
  server.listen(REDIRECT_PORT, REDIRECT_HOST);

  const timeout = setTimeout(() => {
    rejectCode(new Error(`Slack OAuth callback 타임아웃 (${AUTH_TIMEOUT_MS / 1000}s)`));
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

export interface SlackClient {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
}

export interface SlackClientOptions {
  authDir?: string;
}

export async function createSlackClient(
  config: Config,
  opts: SlackClientOptions = {},
): Promise<SlackClient> {
  if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
    throw new Error(
      "Slack MCP 사용을 위해 SLACK_CLIENT_ID, SLACK_CLIENT_SECRET 환경변수 설정 필요",
    );
  }

  const authDir = opts.authDir ?? join(process.cwd(), "data", "auth", "slack");
  const provider = new PreRegisteredAuthProvider(
    {
      tokens: join(authDir, "tokens.json"),
      codeVerifier: join(authDir, "code-verifier.json"),
    },
    {
      clientId: config.SLACK_CLIENT_ID,
      clientSecret: config.SLACK_CLIENT_SECRET,
    },
  );

  const transport = new StreamableHTTPClientTransport(new URL(SLACK_MCP_URL), {
    authProvider: provider,
  });
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION }, { capabilities: {} });

  try {
    await client.connect(transport);
    return wrap(client, transport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
  }

  logger.info("Slack OAuth 인증 필요 — loopback 콜백 서버 시작");
  const callback = startCallbackServer();
  try {
    const code = await callback.codePromise;
    await transport.finishAuth(code);
  } finally {
    await callback.close();
  }

  await client.connect(transport);
  logger.info("Slack MCP 연결 성공");
  return wrap(client, transport);
}

function wrap(client: Client, transport: StreamableHTTPClientTransport): SlackClient {
  return {
    client,
    transport,
    close: () => client.close(),
  };
}
