type TraceEvent =
  | { event: 'orchestrator_start'; question: string }
  | { event: 'orchestrator_round'; round: number; tasks: { id: string; question: string }[] }
  | { event: 'worker_start'; workerId: string; question: string }
  | { event: 'tool_call'; agentId: string; tool: string; input: unknown }
  | { event: 'worker_end'; workerId: string; ms: number; tokensIn: number; tokensOut: number }
  | { event: 'final_report'; citationCount: number };

export function trace(event: TraceEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  process.stdout.write(line + '\n');
}
