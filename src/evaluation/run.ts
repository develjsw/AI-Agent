import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import yaml from "yaml";

import { GoldenQA } from "@/shared/schema.js";
import { child, loadConfig } from "@/shared/index.js";
import { answerQuestion } from "@/agents/qa.js";
import { evaluateAnswerRelevancy, evaluateFaithfulness } from "@/evaluation/judge.js";

const log = child({ module: "evaluation" });

const GOLDEN_SET_PATH = resolve("src/evaluation/golden-set.yaml");
const REPORTS_DIR = resolve("src/evaluation/reports");
const GoldenSetSchema = z.array(GoldenQA);

interface Summary {
  totalQuestions: number;
  avgRecall: number;
  avgFaithfulness: number;
  avgAnswerRelevancy: number;
  fullHits: number;
  misses: number;
}

interface Report {
  timestamp: string;
  goldenSetSize: number;
  summary: Summary;
  rows: EvaluationRow[];
}

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

function buildSummary(rows: EvaluationRow[]): Summary {
  return {
    totalQuestions: rows.length,
    avgRecall: average(rows, (row) => row.recall),
    avgFaithfulness: average(rows, (row) => row.faithfulness),
    avgAnswerRelevancy: average(rows, (row) => row.answerRelevancy),
    fullHits: rows.filter((row) => row.recall === 1).length,
    misses: rows.filter((row) => row.recall === 0).length,
  };
}

function printSummary(summary: Summary): void {
  const { totalQuestions, avgRecall, avgFaithfulness, avgAnswerRelevancy, fullHits, misses } =
    summary;
  console.log(`\n총 ${totalQuestions}개`);
  console.log(`  평균 recall@5      : ${avgRecall.toFixed(3)}`);
  console.log(`  평균 faithfulness  : ${avgFaithfulness.toFixed(3)}`);
  console.log(`  평균 answer rel.   : ${avgAnswerRelevancy.toFixed(3)}`);
  console.log(`  완전 회수: ${fullHits}/${totalQuestions}  |  완전 미스: ${misses}/${totalQuestions}\n`);
}

// 파일명용 timestamp slug — UTC 기준 yyyymmdd-hhmmss
function timestampSlug(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function writeReport(rows: EvaluationRow[], summary: Summary): string {
  const now = new Date();
  const report: Report = {
    timestamp: now.toISOString(),
    goldenSetSize: rows.length,
    summary,
    rows,
  };
  mkdirSync(REPORTS_DIR, { recursive: true });
  const path = resolve(REPORTS_DIR, `eval-${timestampSlug(now)}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
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

  const summary = buildSummary(rows);
  printSummary(summary);

  const reportPath = writeReport(rows, summary);
  log.info({ path: reportPath }, "report saved");
}

main().catch((err) => {
  let message: unknown = err;
  if (err instanceof Error) message = err.message;
  log.error({ err: message }, "evaluation failed");
  process.exit(1);
});