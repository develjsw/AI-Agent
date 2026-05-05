import { z } from "zod";

const ConfigSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CHROMA_URL: z.string().url().default("http://localhost:8000"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  CHAT_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Atlassian — required when ingesting Jira/Confluence (validated per-source)
  ATLASSIAN_SITE: z.string().min(1).optional(),
  ATLASSIAN_EMAIL: z.string().email().optional(),
  ATLASSIAN_API_TOKEN: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
