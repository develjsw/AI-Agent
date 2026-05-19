import { Document, child, loadConfig, uuidV5 } from "@/shared/index.js";
import { adfToText } from "@/ingestion/adf.js";

const log = child({ module: "ingestion.confluence" });

// Confluence 페이지 ID마다 동일한 UUID가 나오도록 고정한 namespace
const CONFLUENCE_UUID_NAMESPACE = "5c4d3e2f-1a0b-4d5c-8e7f-6a5b4c3d2e1f";

export interface ConfluenceEnv {
  site: string;
  email: string;
  token: string;
}

export function loadConfluenceEnv(): ConfluenceEnv {
  const config = loadConfig();
  if (!config.ATLASSIAN_SITE || !config.ATLASSIAN_EMAIL || !config.ATLASSIAN_API_TOKEN) {
    throw new Error(
      "Missing Atlassian environment for Confluence ingestion: ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN",
    );
  }
  return {
    site: config.ATLASSIAN_SITE,
    email: config.ATLASSIAN_EMAIL,
    token: config.ATLASSIAN_API_TOKEN,
  };
}

interface ConfluenceBodyValue {
  representation: string;
  value: string;
}

export interface ConfluencePage {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  parentId?: string | null;
  parentType?: string | null;
  authorId?: string;
  ownerId?: string;
  createdAt: string;
  version?: {
    number: number;
    message?: string;
    createdAt: string;
    authorId?: string;
    minorEdit?: boolean;
  };
  body?: {
    atlas_doc_format?: ConfluenceBodyValue;
  };
  _links?: {
    webui?: string;
    tinyui?: string;
    editui?: string;
  };
}

interface PageListResponse {
  results: ConfluencePage[];
  _links?: {
    next?: string;
  };
}

interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type?: string;
  status?: string;
}

interface SpaceListResponse {
  results: ConfluenceSpace[];
}

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  readonly site: string;

  constructor(env: ConfluenceEnv) {
    this.site = env.site;
    this.baseUrl = `https://${env.site}/wiki/api/v2`;
    this.authHeader =
      "Basic " + Buffer.from(`${env.email}:${env.token}`).toString("base64");
  }

  // _links.next는 v2 endpoint의 상대 경로 ("/api/v2/...?cursor=...")로 내려옴
  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith("http")) return pathOrUrl;
    if (pathOrUrl.startsWith("/wiki/")) return `https://${this.site}${pathOrUrl}`;
    if (pathOrUrl.startsWith("/api/v2")) return `https://${this.site}/wiki${pathOrUrl}`;
    return `${this.baseUrl}${pathOrUrl}`;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.resolveUrl(pathOrUrl), {
      ...init,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Confluence API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`,
      );
    }
    return (await response.json()) as T;
  }

  async getPage(pageId: string): Promise<ConfluencePage> {
    const params = new URLSearchParams({ "body-format": "atlas_doc_format" });
    return this.request<ConfluencePage>(`/pages/${encodeURIComponent(pageId)}?${params}`);
  }

  async getSpaceByKey(spaceKey: string): Promise<ConfluenceSpace> {
    const params = new URLSearchParams({ keys: spaceKey });
    const response = await this.request<SpaceListResponse>(`/spaces?${params}`);
    const space = response.results[0];
    if (!space) throw new Error(`Confluence space not found: key=${spaceKey}`);
    return space;
  }

  async *listPagesInSpace(
    spaceId: string,
    batchSize = 50,
  ): AsyncGenerator<ConfluencePage> {
    const initialParams = new URLSearchParams({
      "body-format": "atlas_doc_format",
      limit: String(batchSize),
    });
    let nextPath: string | undefined = `/spaces/${encodeURIComponent(spaceId)}/pages?${initialParams}`;
    let pageNumber = 0;
    while (nextPath) {
      const response: PageListResponse = await this.request<PageListResponse>(nextPath);
      pageNumber += 1;
      log.debug(
        { page: pageNumber, batch: response.results.length, hasNext: Boolean(response._links?.next) },
        "list pages page",
      );
      for (const page of response.results) yield page;
      nextPath = response._links?.next;
    }
  }
}

// _links.webui: "/spaces/{KEY}/pages/{ID}/{Title}" — spaceKey만 추출
function extractSpaceKey(webui: string | undefined): string | undefined {
  if (!webui) return undefined;
  const match = webui.match(/^\/spaces\/([^/]+)\//);
  if (match) return match[1];
  return undefined;
}

function parseAtlasDocFormat(value: ConfluenceBodyValue | undefined): unknown {
  if (!value || !value.value) return null;
  try {
    return JSON.parse(value.value);
  } catch (error) {
    log.warn({ err: error }, "failed to parse atlas_doc_format JSON");
    return null;
  }
}

export function pageToDocument(page: ConfluencePage, site: string): Document {
  const title = page.title;
  const bodyDoc = parseAtlasDocFormat(page.body?.atlas_doc_format);
  const bodyText = adfToText(bodyDoc).trim();

  const sections = [`# ${title}`];
  if (bodyText) sections.push(`## 내용\n${bodyText}`);
  const content = sections.join("\n\n");

  const webui = page._links?.webui;
  const spaceKey = extractSpaceKey(webui);
  const sourceUrl = webui
    ? `https://${site}/wiki${webui}`
    : `https://${site}/wiki/pages/viewpage.action?pageId=${page.id}`;

  // 최초 작성 시각은 page.createdAt, 마지막 수정 시각은 version.createdAt(없으면 createdAt 폴백)
  const createdAt = new Date(page.createdAt);
  const updatedAt = new Date(page.version?.createdAt ?? page.createdAt);

  const document: Document = {
    id: uuidV5(`confluence:${page.id}`, CONFLUENCE_UUID_NAMESPACE),
    source: "confluence",
    sourceId: page.id,
    sourceUrl,
    title,
    content,
    createdAt,
    updatedAt,
    permissions: {
      public: false,
      spaceKey,
    },
    metadata: {
      status: page.status,
      spaceId: page.spaceId,
      parentId: page.parentId ?? null,
      parentType: page.parentType ?? null,
      authorAccountId: page.authorId,
      ownerAccountId: page.ownerId,
      versionNumber: page.version?.number,
      versionMessage: page.version?.message,
      versionAuthorAccountId: page.version?.authorId,
      contentChars: content.length,
      bodyChars: bodyText.length,
    },
  };

  return Document.parse(document);
}
