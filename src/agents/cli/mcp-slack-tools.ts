import { loadConfig } from "@/shared/index.js";
import { createSlackClient } from "../mcp/slack-client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const { client, close } = await createSlackClient(config);
  try {
    const tools = await client.listTools();
    console.log(`\n사용 가능한 Slack 도구 ${tools.tools.length}개:\n`);
    for (const tool of tools.tools) {
      const desc = (tool.description ?? "").split("\n")[0]?.slice(0, 120) ?? "";
      console.log(`- ${tool.name}${desc ? ` — ${desc}` : ""}`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
