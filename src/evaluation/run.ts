import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import yaml from "yaml";

import { GoldenQA } from "@/shared/schema.js";
import { child, loadConfig } from "@/shared/index.js";
import { answerQuestion } from "@/agents/qa.js";
import { evaluateAnswerRelevancy, evaluateFaithfulness } from "@/evaluation/judge.js";

const log = child({ module: "evaluation" });

const GOLDEN_SET_PATH = resolve("src/evaluation/golden-set.yaml");
const GoldenSetSchema = z.array(GoldenQA);

interface EvaluationRow {
  id: string;
  question: string;
  expectedSources: string[];
  retrievedSources: string[];
  hits: string[];
  recall: number;
  topDistance: number;
  answer: string;
  faithfulness: number;
  faithfulnessReasoning: string;
  answerRelevancy: number;
  answerRelevancyReasoning: string;
}

// Jira 이슈 URL에서 키 추출 (예: .../browse/ITSM-3226 → ITSM-3226)
function extractJiraKey(url: string): string {
  const match = url.match(/\/browse\/([^/?#]+)/);
  const key = match?.[1];
  if (!key) throw new Error(`Jira URL 패턴 불일치: ${url}`);
  return key;
}

function loadGoldenSet(): GoldenQA[] {
  const raw = readFileSync(GOLDEN_SET_PATH, "utf-8");
  const parsed = yaml.parse(raw);
  return GoldenSetSchema.parse(parsed);
}

async function evaluateOne(qa: GoldenQA): Promise<EvaluationRow> {
  const result = await answerQuestion(qa.question);
  const retrievedSources = result.sources.map((source) => extractJiraKey(source.url));
  const retrievedSet = new Set(retrievedSources);
  const hits = qa.expectedSources.filter((key) => retrievedSet.has(key));
  const recall = qa.expectedSources.length === 0 ? 1 : hits.length / qa.expectedSources.length;
  const topDistance = result.sources[0]?.distance ?? Number.NaN;

  // LLM-as-judge 메트릭은 faithfulness ↔ answer relevancy 의존성 없음 → 병렬 호출
  const contexts = result.sources.map((source) => source.content);
  const [faith, relevancy] = await Promise.all([
    evaluateFaithfulness(qa.question, result.answer, contexts),
    evaluateAnswerRelevancy(qa.question, result.answer),
  ]);

  return {
    id: qa.id,
    question: qa.question,
    expectedSources: qa.expectedSources,
    retrievedSources,
    hits,
    recall,
    topDistance,
    answer: result.answer,
    faithfulness: faith.score,
    faithfulnessReasoning: faith.reasoning,
    answerRelevancy: relevancy.score,
    answerRelevancyReasoning: relevancy.reasoning,
  };
}

function recallTag(recall: number): string {
  if (recall === 1) return "OK  ";
  if (recall === 0) return "MISS";
  return "PART";
}

function printRow(row: EvaluationRow): void {
  const tag = recallTag(row.recall);
  console.log(
    `[${tag}] ${row.id}  recall=${row.recall.toFixed(2)}  faith=${row.faithfulness.toFixed(2)}  rel=${row.answerRelevancy.toFixed(2)}  top1_dist=${row.topDistance.toFixed(3)}`,
  );
  console.log(`        Q: ${row.question}`);
  console.log(`        expected: [${row.expectedSources.join(", ")}]`);
  console.log(`        retrieved(top5): [${row.retrievedSources.join(", ")}]`);
  console.log(`        faith: ${row.faithfulnessReasoning}`);
  console.log(`        rel  : ${row.answerRelevancyReasoning}`);
}

function average(rows: EvaluationRow[], pick: (row: EvaluationRow) => number): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((acc, row) => acc + pick(row), 0);
  return sum / rows.length;
}

function printSummary(rows: EvaluationRow[]): void {
  const total = rows.length;
  const avgRecall = average(rows, (row) => row.recall);
  const avgFaith = average(rows, (row) => row.faithfulness);
  const avgRel = average(rows, (row) => row.answerRelevancy);
  const fullHits = rows.filter((row) => row.recall === 1).length;
  const misses = rows.filter((row) => row.recall === 0).length;

  console.log(`\n총 ${total}개`);
  console.log(`  평균 recall@5      : ${avgRecall.toFixed(3)}`);
  console.log(`  평균 faithfulness  : ${avgFaith.toFixed(3)}`);
  console.log(`  평균 answer rel.   : ${avgRel.toFixed(3)}`);
  console.log(`  완전 회수: ${fullHits}/${total}  |  완전 미스: ${misses}/${total}\n`);
}

async function main() {
  loadConfig();
  const goldenSet = loadGoldenSet();

  if (goldenSet.length === 0) {
    log.warn("golden-set.yaml 비어있음 — 평가 대상 없음");
    return;
  }

  log.info({ count: goldenSet.length }, "golden set loaded");

  const rows: EvaluationRow[] = [];
  for (const qa of goldenSet) {
    log.info({ id: qa.id }, "evaluating");
    rows.push(await evaluateOne(qa));
  }

  console.log("\n=== 평가 결과 ===\n");
  for (const row of rows) printRow(row);
  printSummary(rows);
}

main().catch((err) => {
  let message: unknown = err;
  if (err instanceof Error) message = err.message;
  log.error({ err: message }, "evaluation failed");
  process.exit(1);
});