import 'dotenv/config';
import { research } from './agents/orchestrator.ts';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('사용법: pnpm research "<질문>"');
  process.exit(1);
}

const { report, stats } = await research(question);

console.log('\n=== 최종 리포트 ===');
console.log(report.summary);
console.log('\n=== 인용 ===');
for (const c of report.citations) {
  console.log(`- ${c.url}\n  "${c.quote}"`);
}

console.log('\n=== 실행 통계 ===');
console.log(`소요 시간: ${(stats.elapsedMs / 1000).toFixed(1)}초`);
console.log(`라운드: ${stats.rounds}, 워커: ${stats.workers}`);
console.log(`토큰: prompt=${stats.promptTokens}, completion=${stats.completionTokens}`);
console.log(`예상 비용: $${stats.totalCost.toFixed(4)}`);
