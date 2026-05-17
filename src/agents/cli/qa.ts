import { child, loadConfig } from "@/shared/index.js";
import { answerQuestion } from "@/agents/qa.js";

const log = child({ module: "qa-cli" });

function usage(): never {
  log.error('usage: pnpm qa "질문 내용"');
  process.exit(1);
}

async function main() {
  loadConfig();
  const [, , ...rest] = process.argv;
  const question = rest.join(" ").trim();
  if (!question) usage();

  const result = await answerQuestion(question);

  console.log(`\n질문: ${result.question}\n`);
  console.log(`라우팅: ${result.routing.decision} — ${result.routing.reason}\n`);
  console.log(`답변:\n${result.answer}\n`);

  if (result.sources.length > 0) {
    console.log(`RAG 출처:`);
    for (const source of result.sources) {
      let distance: string;
      if (Number.isNaN(source.distance)) distance = "n/a (BM25)";
      else distance = source.distance.toFixed(3);
      console.log(`  [${source.rank}] ${source.title} — ${source.url}  (distance=${distance})`);
    }
  }

  if (result.mcpJira) {
    const jira = result.mcpJira;
    console.log(`\nMCP Jira 티켓 (실시간):`);
    console.log(
      `  ${jira.key} — ${jira.summary}  (status=${jira.status}, assignee=${jira.assignee ?? "미지정"})`,
    );
    console.log(`    ${jira.url}`);
  }

  if (result.mcpSlack) {
    const slack = result.mcpSlack;
    console.log(
      `\nMCP Slack 검색 (실시간): "${slack.query}" — ${slack.resultCount}건  (다음 cursor: ${slack.nextCursor ?? "끝"})`,
    );
  }
}

main().catch((error) => {
  let message: unknown = error;
  if (error instanceof Error) message = error.message;
  log.error({ err: message }, "qa failed");
  process.exit(1);
});
