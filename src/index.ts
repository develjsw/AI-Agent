import { research } from './agents/orchestrator.ts';

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('사용법: pnpm research "<질문>"');
    process.exit(1);
  }

  const report = await research(question);

  console.log('\n=== 최종 리포트 ===\n');
  console.log(report.summary);
  console.log('\n=== 인용 ===\n');
  for (const c of report.citations) {
    console.log(`- ${c.url}\n  "${c.quote}"`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
