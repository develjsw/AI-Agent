import { createAtlassianMcpClient } from "./mcp-clients.js";

async function main(): Promise<void> {
  const { client, close } = await createAtlassianMcpClient();
  try {
    const tools = await client.listTools();
    console.log(`\n사용 가능한 도구 ${tools.tools.length}개:\n`);
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
