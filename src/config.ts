export const MODELS = {
  orchestrator: 'gpt-5',
  worker: 'gpt-5-mini',
} as const;

export const LIMITS = {
  maxRounds: 3,
  maxWorkersTotal: 10,
  maxToolCallsPerWorker: 5,
  maxOrchestratorSteps: 8,
  maxOutputTokensWorker: 2048,
  maxOutputTokensOrchestrator: 4096,
  maxSearchResults: 5,
  maxFetchedTextChars: 8000,
} as const;
