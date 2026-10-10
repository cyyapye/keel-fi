// A healthy capture proves access, not fresh refresh-token lifetime, so keep an
// earlier renewal. Recovery after an attempted renewal must restart the window
// with its retry counter; clearing retries alone would admit hourly failures.
export function recordProviderSessionVerification(
  db: D1Database,
  householdId: string,
  provider: string,
  now: Date,
  freshReconnect = false,
): D1PreparedStatement[] {
  if (provider !== "sydecar") return [];
  return [
    db
      .prepare(
        `INSERT INTO provider_session_renewals
    (agent_id, last_verified_at, next_check_at)
    SELECT id, ?, ? FROM provider_portfolio_agents
    WHERE household_id = ? AND provider = 'sydecar'
    ON CONFLICT(agent_id) DO UPDATE SET
      last_verified_at = excluded.last_verified_at,
      next_check_at = CASE WHEN ? OR provider_session_renewals.attempts > 0
        THEN excluded.next_check_at
        ELSE MIN(provider_session_renewals.next_check_at, excluded.next_check_at) END,
      attempts = 0, lease_token_sha256 = NULL, lease_expires_at = NULL,
      last_outcome_token_sha256 = NULL, last_error_code = NULL,
      last_failure_reason = NULL,
      refresh_expires_at = CASE WHEN ? THEN NULL ELSE provider_session_renewals.refresh_expires_at END`,
      )
      .bind(
        now.toISOString(),
        new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
        householdId,
        freshReconnect ? 1 : 0,
        freshReconnect ? 1 : 0,
      ),
  ];
}
