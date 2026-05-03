import 'dotenv/config';
import { research } from './agents/orchestrator.ts';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('사용법: pnpm research "<질문>"');
  process.exit(1);
}

const report = await research(question);

console.log('\n=== 최종 리포트 ===');
console.log(report.summary);
console.log('\n=== 인용 ===');
for (const c of report.citations) {
  console.log(`- ${c.url}\n  "${c.quote}"`);
}
