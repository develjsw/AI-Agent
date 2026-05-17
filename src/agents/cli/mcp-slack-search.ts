import { loadConfig } from "@/shared/index.js";
import { createSlackClient } from "../mcp/slack-client.js";
import { searchSlack, summarizeSlackSearch } from "../mcp/tools/slack-search.js";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('usage: pnpm mcp:slack:search "검색어"');
    process.exit(2);
  }

  const config = loadConfig();
  const { client, close } = await createSlackClient(config);
  try {
    const tool = (await client.listTools()).tools.find(
      (entry) => entry.name === "slack_search_public_and_private",
    );
    if (tool) {
      console.log("\n[slack_search_public_and_private inputSchema]");
      console.log(JSON.stringify(tool.inputSchema, null, 2));
    }

    console.log(`\n[검색 호출: "${query}"]`);
    const raw = await searchSlack(client, query);
    const summary = summarizeSlackSearch(raw);

    console.log(
      `\n[Summary] ${summary.resultCount}건  (다음 cursor: ${summary.nextCursor ?? "끝"})`,
    );
    console.log(summary.markdown);

    if (process.env.MCP_SLACK_RAW === "1") {
      console.log("\n[Raw]");
      console.log(JSON.stringify(raw.content, null, 2));
    } else {
      console.log("\n(raw 본체 보려면 MCP_SLACK_RAW=1 환경변수 설정 후 재실행)");
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
