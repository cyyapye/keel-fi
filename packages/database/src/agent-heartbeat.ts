// These timestamps describe recent activity; they do not authorize requests.
// Authentication and credential revocation are checked on every request.
export const AGENT_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export function agentHeartbeatCutoff(now: Date): string {
  return new Date(now.getTime() - AGENT_HEARTBEAT_INTERVAL_MS).toISOString();
}
