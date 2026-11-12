import {
  AppGrantSchema,
  AppScopesSchema,
  scopePermissions,
  type AppScope,
} from "@keel/domain/app-access";

export class AppAccessError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}
export type Principal = {
  grantId: string;
  credentialId: string;
  householdId: string;
  subject: string;
  scopes: AppScope[];
  kind: "key" | "access";
  agentRotation: boolean;
  expiresAt: string | null;
};
export type GrantRow = {
  id: string;
  sequence: number;
  household_id: string;
  user_id: string;
  name: string;
  kind: "key" | "oauth";
  client_id: string | null;
  scopes_json: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  agent_rotation: number;
  key_suffix: string | null;
  previous_key_expires_at: string | null;
  client_origin?: string | null;
};
export function grantView(r: GrantRow) {
  return AppGrantSchema.parse({
    id: r.id,
    sequence: r.sequence,
    name: r.name,
    kind: r.kind,
    permissions: scopePermissions(
      AppScopesSchema.parse(JSON.parse(r.scopes_json)),
    ),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    rotation: r.agent_rotation ? "agent" : "manual",
    suffix: r.key_suffix,
    previousKeyExpiresAt: r.previous_key_expires_at,
    clientOrigin: r.client_origin ?? null,
  });
}
export function secret(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return (
    prefix +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  );
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function deadline(now: string, seconds: number, cap?: string | null) {
  const date = new Date(Date.parse(now) + seconds * 1000).toISOString();
  return cap && cap < date ? cap : date;
}
export class AppAccessStore {
  constructor(
    public db: D1Database,
    public now = new Date().toISOString(),
  ) {}
  async owner(subject: string) {
    const rows = await this.db
      .prepare(
        `SELECT h.id household_id,u.id user_id FROM users u JOIN households h ON h.owner_user_id=u.id WHERE u.access_subject=? LIMIT 2`,
      )
      .bind(subject)
      .all<{ household_id: string; user_id: string }>();
    if (rows.results.length !== 1)
      throw new AppAccessError(403, "No authorized household.");
    return rows.results[0]!;
  }
  async list(household: string, after: number, kind: "key" | "oauth") {
    const rows = await this.db
      .prepare(
        `SELECT g.*,c.origin client_origin FROM app_access_grants g LEFT JOIN app_access_clients c ON c.id=g.client_id WHERE g.household_id=? AND g.kind=? AND g.sequence<? ORDER BY g.sequence DESC LIMIT 51`,
      )
      .bind(household, kind, after)
      .all<GrantRow>();
    return {
      grants: rows.results.slice(0, 50).map(grantView),
      nextAfter:
        rows.results.length > 50 ? String(rows.results[49]!.sequence) : null,
    };
  }
  async get(household: string, id: string) {
    const row = await this.db
      .prepare(
        `SELECT g.*,c.origin client_origin FROM app_access_grants g LEFT JOIN app_access_clients c ON c.id=g.client_id WHERE g.id=? AND g.household_id=?`,
      )
      .bind(id, household)
      .first<GrantRow>();
    if (!row) throw new AppAccessError(404, "Connection not found.");
    return row;
  }
  async authenticate(token: string): Promise<Principal | null> {
    if (!/^keel_(?:key|access)_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = await this.db
      .prepare(
        `SELECT g.id grant_id,g.household_id,g.scopes_json,g.agent_rotation,g.expires_at,u.access_subject,c.id credential_id,c.kind FROM app_access_credentials c JOIN app_access_grants g ON g.id=c.grant_id JOIN users u ON u.id=g.user_id JOIN households h ON h.id=g.household_id AND h.owner_user_id=u.id WHERE c.token_hash=? AND c.kind IN ('key','access') AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>?) AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)`,
      )
      .bind(await digest(token), this.now, this.now)
      .first<{
        grant_id: string;
        household_id: string;
        scopes_json: string;
        agent_rotation: number;
        expires_at: string | null;
        access_subject: string;
        credential_id: string;
        kind: "key" | "access";
      }>();
    return row
      ? {
          grantId: row.grant_id,
          credentialId: row.credential_id,
          householdId: row.household_id,
          subject: row.access_subject,
          scopes: AppScopesSchema.parse(JSON.parse(row.scopes_json)),
          kind: row.kind,
          agentRotation: row.agent_rotation === 1,
          expiresAt: row.expires_at,
        }
      : null;
  }
  credential(
    id: string,
    grant: string,
    kind: string,
    hash: string,
    expires: string | null,
  ) {
    return this.db
      .prepare(
        `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)`,
      )
      .bind(id, grant, kind, hash, this.now, expires);
  }
  async createKey(
    owner: { household_id: string; user_id: string },
    name: string,
    scopes: AppScope[],
    days: number,
    rotate: boolean,
  ) {
    const id = crypto.randomUUID(),
      token = secret("keel_key_"),
      expires = deadline(this.now, days * 86400);
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO app_access_grants(id,household_id,user_id,kind,name,scopes_json,created_at,expires_at,agent_rotation,key_suffix) VALUES(?,?,?,'key',?,?,?,?,?,?)`,
        )
        .bind(
          id,
          owner.household_id,
          owner.user_id,
          name,
          JSON.stringify(scopes),
          this.now,
          expires,
          rotate ? 1 : 0,
          token.slice(-4),
        ),
      this.credential(
        crypto.randomUUID(),
        id,
        "key",
        await digest(token),
        expires,
      ),
    ]);
    return {
      key: token,
      grant: grantView(await this.get(owner.household_id, id)),
    };
  }
  async revoke(household: string, id: string) {
    await this.db
      .prepare(
        `UPDATE app_access_grants SET revoked_at=coalesce(revoked_at,?) WHERE id=? AND household_id=?`,
      )
      .bind(this.now, id, household)
      .run();
  }
  async rotate(household: string, id: string, credentialId?: string) {
    const grant = await this.get(household, id);
    if (
      grant.kind !== "key" ||
      grant.revoked_at ||
      !grant.expires_at ||
      grant.expires_at <= this.now
    )
      throw new AppAccessError(409, "Only an active API key can be rotated.");
    if (credentialId && !grant.agent_rotation)
      throw new AppAccessError(403, "Agent rotation was not granted.");
    const key = secret("keel_key_"),
      nextId = crypto.randomUUID(),
      overlap = deadline(this.now, 86400, grant.expires_at);
    // Claim the one current generation atomically. INSERT and grant update depend on that exact claim.
    const result = await this.db.batch([
      this.db
        .prepare(
          `UPDATE app_access_credentials SET replaced_by=?,expires_at=? WHERE grant_id=? AND kind='key' AND replaced_by IS NULL AND revoked_at IS NULL AND expires_at>? AND (? IS NULL OR id=?) AND NOT EXISTS(SELECT 1 FROM app_access_credentials p WHERE p.grant_id=? AND p.replaced_by IS NOT NULL AND p.expires_at>?) AND EXISTS(SELECT 1 FROM app_access_grants g WHERE g.id=? AND g.revoked_at IS NULL AND g.expires_at>?)`,
        )
        .bind(
          nextId,
          overlap,
          id,
          this.now,
          credentialId ?? null,
          credentialId ?? null,
          id,
          this.now,
          id,
          this.now,
        ),
      this.db
        .prepare(
          `INSERT INTO app_access_credentials(id,grant_id,kind,token_hash,created_at,expires_at) SELECT ?,?,'key',?,?,? WHERE EXISTS(SELECT 1 FROM app_access_credentials WHERE grant_id=? AND replaced_by=?)`,
        )
        .bind(
          nextId,
          id,
          await digest(key),
          this.now,
          grant.expires_at,
          id,
          nextId,
        ),
      this.db
        .prepare(
          `UPDATE app_access_grants SET key_suffix=?,previous_key_expires_at=? WHERE id=? AND EXISTS(SELECT 1 FROM app_access_credentials WHERE id=?)`,
        )
        .bind(key.slice(-4), overlap, id, nextId),
      this.db
        .prepare(
          `DELETE FROM app_access_credentials WHERE grant_id=? AND expires_at<=?`,
        )
        .bind(id, this.now),
    ]);
    if (result[0]!.meta.changes !== 1)
      throw new AppAccessError(
        409,
        "A replacement is already pending, or this key is no longer current. Save the replacement before rotating again; if it was lost, revoke this grant and create a new key in Keel.",
      );
    return { key, grant: grantView(await this.get(household, id)) };
  }
}
