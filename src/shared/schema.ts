import { z } from "zod";

export const SourceType = z.enum([
  "confluence",
  "jira",
  "slack",
  "gdrive",
  "figma",
  "db",
  "github",
]);
export type SourceType = z.infer<typeof SourceType>;

export const Permissions = z.object({
  public: z.boolean().default(false),
  spaceKey: z.string().optional(),
  projectKey: z.string().optional(),
  channelId: z.string().optional(),
  folderId: z.string().optional(),
  repo: z.string().optional(),
});
export type Permissions = z.infer<typeof Permissions>;

export const Document = z.object({
  id: z.string().uuid(),
  source: SourceType,
  sourceId: z.string(),
  sourceUrl: z.string().url(),
  title: z.string(),
  content: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  author: z.string().optional(),
  permissions: Permissions,
  metadata: z.record(z.unknown()).default({}),
});
export type Document = z.infer<typeof Document>;

export const ChunkMetadata = z.object({
  source: SourceType,
  sourceUrl: z.string().url(),
  title: z.string(),
  author: z.string().optional(),
  permissions: Permissions,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadata>;

export const Chunk = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  content: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  tokenCount: z.number().int().positive().optional(),
  metadata: ChunkMetadata,
});
export type Chunk = z.infer<typeof Chunk>;

export const RouterDecisionLabel = z.enum(["RAG", "MCP", "HYBRID"]);
export type RouterDecisionLabel = z.infer<typeof RouterDecisionLabel>;

export const GoldenQA = z.object({
  id: z.string(),
  question: z.string(),
  expectedAnswerSummary: z.string(),
  expectedSources: z.array(z.string()),
  expectedDecision: RouterDecisionLabel.optional(),
  tags: z.array(z.string()).default([]),
});
export type GoldenQA = z.infer<typeof GoldenQA>;
