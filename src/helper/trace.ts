type TraceEvent =
  | { event: 'orchestrator_start'; question: string }
  | { event: 'round_dispatch'; round: number; tasks: Array<{ id: string; question: string }> }
  | { event: 'tool_call'; agentId: string; tool: string; args: unknown }
  | { event: 'worker_done'; agentId: string; citationCount: number }
  | { event: 'worker_failed'; agentId: string; message: string }
  | { event: 'budget_exceeded'; budget: 'rounds' | 'workers'; limit: number }
  | { event: 'agent_fallback'; agentId: string; reason: string }
  | { event: 'final_report'; citationCount: number };

export function trace(event: TraceEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  process.stdout.write(line + '\n');
}
