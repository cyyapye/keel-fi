import {
  MacAgentTargetSchema,
  MacAgentTokenSchema,
  type MacAgentTarget,
  type MacAgentToken,
} from "@keel/domain";

import { agentHeartbeatCutoff } from "./agent-heartbeat";

type HouseholdIdentity = {
  household_id: string;
  user_id: string;
};

type CredentialUseRow = {
  credential_rowid: number;
  household_id: string;
  id: string;
  access_subject: string;
  last_used_at: string | null;
  retire_older: number;
};

type CredentialRow = { id: string };

export interface MacAgentCredentialRepository {
  issueToken(
    accessSubject: string,
    target: MacAgentTarget,
  ): Promise<MacAgentToken>;
  rotateToken(
    accessSubject: string,
    target: MacAgentTarget,
    currentToken: string,
  ): Promise<MacAgentToken>;
  authenticate(target: MacAgentTarget, token: string): Promise<string | null>;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function newToken(): MacAgentToken {
  return MacAgentTokenSchema.parse(
    `keel_agent_v1_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`,
  );
}

export class D1MacAgentCredentialRepository implements MacAgentCredentialRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async issueToken(
    accessSubject: string,
    rawTarget: MacAgentTarget,
  ): Promise<MacAgentToken> {
    const target = MacAgentTargetSchema.parse(rawTarget);
    const identity = await this.findIdentity(accessSubject);
    const token = newToken();
    const digest = await sha256(token);
    const timestamp = this.now().toISOString();

    await this.db.batch([
      this.db
        .prepare(
          `UPDATE mac_agent_credentials
           SET revoked_at = MAX(issued_at, ?)
           WHERE household_id = ? AND target = ? AND revoked_at IS NULL`,
        )
        .bind(timestamp, identity.household_id, target),
      this.db
        .prepare(
          `INSERT INTO mac_agent_credentials (
             id, household_id, target, token_sha256, issued_by_user_id,
             issued_at, last_used_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          target,
          digest,
          identity.user_id,
          timestamp,
        ),
    ]);
    return token;
  }

  public async authenticate(
    rawTarget: MacAgentTarget,
    rawToken: string,
  ): Promise<string | null> {
    const target = MacAgentTargetSchema.safeParse(rawTarget);
    const token = MacAgentTokenSchema.safeParse(rawToken);
    if (!target.success || !token.success) {
      return null;
    }
    const digest = await sha256(token.data);
    const used = await this.db
      .prepare(
        `SELECT credential.rowid AS credential_rowid,
           credential.id, credential.household_id, credential.last_used_at,
           user.access_subject,
           (EXISTS (
             SELECT 1 FROM mac_agent_credentials older
             WHERE older.household_id = credential.household_id
               AND older.target = credential.target AND older.revoked_at IS NULL
               AND older.rowid < credential.rowid
           ) AND NOT EXISTS (
             SELECT 1 FROM mac_agent_credentials newer
             WHERE newer.household_id = credential.household_id
               AND newer.target = credential.target AND newer.revoked_at IS NULL
               AND newer.rowid > credential.rowid
           )) AS retire_older
         FROM mac_agent_credentials credential
         JOIN households household ON household.id = credential.household_id
         JOIN users user ON user.id = household.owner_user_id
         WHERE credential.target = ? AND credential.token_sha256 = ?
           AND credential.revoked_at IS NULL`,
      )
      .bind(target.data, digest)
      .first<CredentialUseRow>();
    if (used === null) {
      return null;
    }
    const now = this.now();
    const timestamp = now.toISOString();
    const cutoff = agentHeartbeatCutoff(now);
    const statements: D1PreparedStatement[] = [];
    if (used.last_used_at === null || used.last_used_at <= cutoff) {
      statements.push(
        this.db
          .prepare(
            `UPDATE mac_agent_credentials
             SET last_used_at = MAX(issued_at, COALESCE(last_used_at, issued_at), ?)
             WHERE id = ? AND revoked_at IS NULL
               AND (last_used_at IS NULL OR last_used_at <= ?)`,
          )
          .bind(timestamp, used.id, cutoff),
      );
    }
    // A replacement must retire older credentials on its first successful
    // use, independently of the heartbeat cadence. Commit both changes together.
    if (used.retire_older === 1) {
      statements.push(
        this.db
          .prepare(
            `UPDATE mac_agent_credentials
             SET revoked_at = MAX(issued_at, ?)
             WHERE household_id = ? AND target = ? AND rowid < ?
               AND revoked_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM mac_agent_credentials current
                 WHERE current.id = ? AND current.revoked_at IS NULL
               )
               AND NOT EXISTS (
                 SELECT 1 FROM mac_agent_credentials newer
                 WHERE newer.household_id = ? AND newer.target = ?
                   AND newer.revoked_at IS NULL AND newer.rowid > ?
               )`,
          )
          .bind(
            timestamp,
            used.household_id,
            target.data,
            used.credential_rowid,
            used.id,
            used.household_id,
            target.data,
            used.credential_rowid,
          ),
      );
    }
    if (statements.length > 0) {
      await this.db.batch(statements);
    }
    return used.access_subject;
  }

  public async rotateToken(
    accessSubject: string,
    rawTarget: MacAgentTarget,
    rawCurrentToken: string,
  ): Promise<MacAgentToken> {
    const target = MacAgentTargetSchema.parse(rawTarget);
    const currentToken = MacAgentTokenSchema.parse(rawCurrentToken);
    const identity = await this.findIdentity(accessSubject);
    const currentDigest = await sha256(currentToken);
    const current = await this.db
      .prepare(
        `SELECT id
         FROM mac_agent_credentials
         WHERE household_id = ? AND target = ? AND token_sha256 = ?
           AND revoked_at IS NULL`,
      )
      .bind(identity.household_id, target, currentDigest)
      .first<CredentialRow>();
    if (current === null) {
      throw new Error("Mac agent credential cannot be rotated.");
    }

    const replacement = newToken();
    const replacementDigest = await sha256(replacement);
    const timestamp = this.now().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE mac_agent_credentials
           SET revoked_at = MAX(issued_at, ?)
           WHERE household_id = ? AND target = ? AND id <> ?
             AND revoked_at IS NULL`,
        )
        .bind(timestamp, identity.household_id, target, current.id),
      this.db
        .prepare(
          `INSERT INTO mac_agent_credentials (
             id, household_id, target, token_sha256, issued_by_user_id,
             issued_at, last_used_at, revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          target,
          replacementDigest,
          identity.user_id,
          timestamp,
        ),
    ]);
    return replacement;
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM households household
         JOIN users user ON user.id = household.owner_user_id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("No household is provisioned for this identity.");
    }
    return identity;
  }
}

export const __macAgentCredentialTest = { sha256 };
