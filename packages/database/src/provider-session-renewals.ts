// A successful capture already proves the ordinary saved-browser path. Keep
// renewal scheduling outside the financial run/import history.
export function recordProviderSessionVerification(
  db: D1Database,
  householdId: string,
  provider: string,
  now: Date,
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
      next_check_at = excluded.next_check_at,
      attempts = 0, lease_token_sha256 = NULL, lease_expires_at = NULL,
      last_outcome_token_sha256 = NULL, last_error_code = NULL`,
      )
      .bind(
        now.toISOString(),
        new Date(now.getTime() + 6 * 60 * 60_000).toISOString(),
        householdId,
      ),
  ];
}
