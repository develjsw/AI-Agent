export const MODELS = {
  orchestrator: 'gpt-5-mini',
  worker: 'gpt-5-mini',
} as const;

export const LIMITS = {
  maxRounds: 3,
  maxWorkersTotal: 10,
  maxOrchestratorSteps: 8,
  maxWorkerSteps: 8,
  maxToolCallsPerWorker: 5,
  maxSearchResults: 5,
  maxFetchedTextChars: 8000,
} as const;
