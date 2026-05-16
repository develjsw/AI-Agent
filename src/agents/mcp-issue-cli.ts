import { createAtlassianMcpClient } from "./mcp-clients.js";
import { getJiraIssue, summarizeJiraIssue } from "./tools/jira-issue.js";

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) {
    console.error("usage: pnpm mcp:issue <ITSM-XXX>");
    process.exit(2);
  }

  const { client, close } = await createAtlassianMcpClient();
  try {
    const raw = await getJiraIssue(client, key);
    const summary = summarizeJiraIssue(raw);

    console.log(`\n[Summary]`);
    console.log(JSON.stringify(summary, null, 2));

    if (process.env.MCP_ISSUE_RAW === "1") {
      console.log(`\n[Raw]`);
      console.log(JSON.stringify(raw.content, null, 2));
    } else {
      console.log(`\n(raw 본체 보려면 MCP_ISSUE_RAW=1 환경변수 설정 후 재실행)`);
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
