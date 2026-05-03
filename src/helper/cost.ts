export type Usage = {
  promptTokens: number;
  completionTokens: number;
};

export type Stats = {
  elapsedMs: number;
  rounds: number;
  workers: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
};

// 1M 토큰당 USD. 모델 ID 변경 시 함께 갱신.
const PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'gpt-5-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o-mini': { inputPerM: 0.15, outputPerM: 0.6 },
  'gpt-4o': { inputPerM: 2.5, outputPerM: 10.0 },
};

export function calcCost(model: string, usage: Usage): number {
  const price = PRICING[model];
  if (!price) return 0;
  const inputUsd = (usage.promptTokens / 1_000_000) * price.inputPerM;
  const outputUsd = (usage.completionTokens / 1_000_000) * price.outputPerM;
  return inputUsd + outputUsd;
}

export function sumUsage(usages: Usage[]): Usage {
  return usages.reduce(
    (acc, u) => ({
      promptTokens: acc.promptTokens + u.promptTokens,
      completionTokens: acc.completionTokens + u.completionTokens,
    }),
    { promptTokens: 0, completionTokens: 0 },
  );
}
