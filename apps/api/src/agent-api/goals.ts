import { OUTLOOK_GOAL_SOURCE } from "@keel/domain";
import { z } from "zod";

export const resourceId = z.string().min(1).max(256);
const date = z.iso.date();
const name = z.string().trim().min(1).max(120);
const money = z.strictObject({
  amountMinor: z.int().nonnegative().max(10_000_000_000_000),
  currency: z.literal("USD"),
});
export const newGoal = z.discriminatedUnion("metric", [
  z.strictObject({
    name,
    metric: z.literal("net_worth"),
    target: money,
    targetDate: date,
  }),
  z.strictObject({
    name,
    metric: z.literal("liquidity_through_date"),
    targetDate: date,
  }),
]);
export const goalPatch = z.union([
  z.strictObject({ status: z.literal("archived") }),
  z
    .strictObject({
      name: name.optional(),
      target: money.optional(),
      targetDate: date.optional(),
    })
    .refine((v) => Object.keys(v).length > 0),
]);
export const goalResource = z.object({
  id: resourceId,
  versionId: resourceId,
  revision: z.int().positive(),
  name: z.string(),
  metric: z.string(),
  unit: z.enum(["minor_units", "months", "count", "ppm"]),
  targetValue: z.int().nonnegative().nullable(),
  targetDate: date.nullable(),
  status: z.enum(["active", "archived"]),
  primary: z.int().min(0).max(1),
  recordedAt: z.string(),
  actor: z.string(),
});
export const goalReceipt = z.object({
  goalId: resourceId,
  versionId: resourceId,
  revision: z.int().positive(),
  actor: z.string(),
});
export const goalList = z.object({
  items: z.array(goalResource),
  nextAfter: z.string().nullable(),
});
const goalVersion = goalResource
  .omit({ primary: true })
  .extend({ changeNote: z.string() });
export const goalVersions = z.object({
  items: z.array(goalVersion),
  nextAfter: z.string().nullable(),
});
export const pageArgs = z.strictObject({
  after: z
    .string()
    .regex(/^[1-9]\d{0,14}$/)
    .optional(),
});
export const goalPageArgs = pageArgs.extend({
  status: z.enum(["active", "archived"]).optional(),
});
export const ETAG = /^"([1-9]\d{0,14})"$/;
export class GoalConflict extends Error {
  constructor(
    public status: 400 | 404 | 409 | 412 | 428,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const columns = `g.id,v.id versionId,v.version revision,v.name,v.metric_key metric,v.target_unit unit,v.target_value_integer targetValue,v.target_date targetDate,
CASE WHEN g.archived_at IS NULL THEN 'active' ELSE 'archived' END status,g.is_primary AS "primary",v.created_at recordedAt,v.created_by actor`;
const latest = `JOIN goal_versions v ON v.id=(SELECT id FROM goal_versions WHERE goal_id=g.id ORDER BY version DESC LIMIT 1) AND v.household_id=g.household_id`;
export async function getGoal(db: D1Database, household: string, id: string) {
  const row = await db
    .prepare(
      `SELECT ${columns} FROM goals g ${latest} WHERE g.household_id=? AND g.id=?`,
    )
    .bind(household, id)
    .first();
  return row ? goalResource.parse(row) : null;
}
export async function getGoalPage(
  db: D1Database,
  household: string,
  after: number,
  status: string,
) {
  // Page the indexed household, including archived entries, before filtering.
  const result = await db
    .prepare(
      `WITH page AS MATERIALIZED (SELECT rowid cursor,* FROM goals WHERE household_id=? AND rowid>? ORDER BY rowid LIMIT 51)
  SELECT g.cursor,${columns} FROM page g ${latest} ORDER BY g.cursor`,
    )
    .bind(household, after)
    .all();
  const rows = z
    .array(goalResource.extend({ cursor: z.int() }))
    .parse(result.results);
  return goalList.parse({
    items: rows.slice(0, 50).filter((g) => g.status === status),
    nextAfter: rows.length > 50 ? String(rows[49]!.cursor) : null,
  });
}
export async function getVersions(
  db: D1Database,
  household: string,
  id: string,
  after: number,
) {
  const [found, versions] = await db.batch([
    db
      .prepare(
        "SELECT g.archived_at archivedAt,(SELECT id FROM goal_versions WHERE goal_id=g.id ORDER BY version DESC LIMIT 1) latestVersionId FROM goals g WHERE g.id=? AND g.household_id=?",
      )
      .bind(id, household),
    db
      .prepare(
        `SELECT ${columns},v.change_note changeNote FROM goals g JOIN goal_versions v ON v.goal_id=g.id AND v.household_id=g.household_id WHERE g.id=? AND g.household_id=? AND v.version>? ORDER BY v.version LIMIT 51`,
      )
      .bind(id, household, after),
  ]);
  if (!found!.results.length) return null;
  const header = z
    .object({ archivedAt: z.string().nullable(), latestVersionId: resourceId })
    .parse(found!.results[0]);
  const rows = z.array(goalVersion).parse(versions!.results);
  const items = rows
    .slice(0, 50)
    .map((v) => ({
      ...v,
      status:
        header.archivedAt === v.recordedAt &&
        header.latestVersionId === v.versionId
          ? "archived"
          : "active",
    }));
  return goalVersions.parse({
    items,
    nextAfter: rows.length > 50 ? String(rows[49]!.revision) : null,
  });
}

async function digest(data: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

type Command =
  | { type: "create"; input: z.infer<typeof newGoal> }
  | {
      type: "patch";
      id: string;
      expected: number;
      input: z.infer<typeof goalPatch>;
    };
export async function writeGoal(
  db: D1Database,
  household: string,
  actor: string,
  key: string,
  cmd: Command,
) {
  // An operation has one immutable version and forecast snapshot. Their keys bind
  // retries to the actor, household and canonical validated request in the same D1 batch.
  const operation = await digest([household, actor, key]);
  const archive = cmd.type === "patch" && "status" in cmd.input;
  const versionId = "goal-version-" + operation;
  const forecastId = "goal-forecast-" + (await digest([operation, cmd]));
  async function replay() {
    const stored = await db
      .prepare(
        `SELECT v.goal_id goalId,v.id versionId,v.version revision,v.created_by actor,f.id fingerprint
      FROM goal_versions v JOIN goal_forecast_snapshots f ON f.goal_version_id=v.id AND f.household_id=v.household_id
      WHERE v.id=? AND v.household_id=?`,
      )
      .bind(versionId, household)
      .first();
    if (!stored) return null;
    if (stored.fingerprint !== forecastId)
      throw new GoalConflict(
        409,
        "idempotency_conflict",
        "This key was used for another request.",
      );
    return goalReceipt.parse(stored);
  }
  const repeated = await replay();
  if (repeated) return repeated;
  const goalId = cmd.type === "create" ? crypto.randomUUID() : cmd.id;
  const now = new Date().toISOString();
  const batch: D1PreparedStatement[] = [];
  let revision = 1;
  if (cmd.type === "create") {
    batch.push(
      db
        .prepare(
          `INSERT INTO goals(id,household_id,template_key,is_primary,archived_at,created_at)
      VALUES(?,?,'custom',NOT EXISTS(SELECT 1 FROM goals WHERE household_id=? AND is_primary=1),NULL,?)`,
        )
        .bind(goalId, household, household, now),
    );
    // The legacy non-null progress column is paired with a distinct source.
    // Both read models expose null until progress is measured by the outlook.
    const isWealth = cmd.input.metric === "net_worth";
    batch.push(
      db
        .prepare(
          `INSERT INTO goal_versions(id,household_id,goal_id,version,name,metric_key,metric_label,target_value_integer,target_unit,target_date,current_value_integer,current_value_source,change_note,created_at,created_by,immutable)
      VALUES(?,?,?,1,?,?,?,?,?,?,0,?,'Owner set a dated target',?,?,1)`,
        )
        .bind(
          versionId,
          household,
          goalId,
          cmd.input.name,
          cmd.input.metric,
          isWealth ? "Tracked net worth" : "Liquidity through date",
          "target" in cmd.input ? cmd.input.target.amountMinor : null,
          isWealth ? "minor_units" : "count",
          cmd.input.targetDate,
          OUTLOOK_GOAL_SOURCE,
          now,
          actor,
        ),
    );
  } else {
    const existing = await getGoal(db, household, goalId);
    if (!existing) throw new GoalConflict(404, "not_found", "Goal not found.");
    if (existing.revision !== cmd.expected) {
      const won = await replay();
      if (won) return won;
      throw new GoalConflict(
        412,
        "stale_revision",
        "Reread the goal and apply the change to its current revision.",
      );
    }
    if (existing.status === "archived")
      throw new GoalConflict(409, "archived", "This goal is archived.");
    if (archive && existing.primary)
      throw new GoalConflict(
        409,
        "primary_goal",
        "Select another primary goal before archiving this one.",
      );
    if (
      !archive &&
      !["net_worth", "liquidity_through_date"].includes(existing.metric)
    )
      throw new GoalConflict(
        409,
        "unsupported_goal",
        "Use the existing goal editor for this goal template.",
      );
    if ("target" in cmd.input && existing.metric !== "net_worth")
      throw new GoalConflict(
        400,
        "invalid_request",
        "A liquidity-through-date goal uses a date and the saved reserve.",
      );
    revision = cmd.expected + 1;
    batch.push(
      db
        .prepare(
          `INSERT INTO goal_versions(id,household_id,goal_id,version,name,metric_key,metric_label,target_value_integer,target_unit,target_date,current_value_integer,current_value_source,change_note,created_at,created_by,immutable)
      SELECT ?,g.household_id,g.id,v.version+1,COALESCE(?,v.name),v.metric_key,v.metric_label,COALESCE(?,v.target_value_integer),v.target_unit,COALESCE(?,v.target_date),v.current_value_integer,v.current_value_source,?,?,?,1
      FROM goals g JOIN goal_versions v ON v.goal_id=g.id AND v.household_id=g.household_id
      WHERE g.id=? AND g.household_id=? AND g.archived_at IS NULL AND v.version=? AND (?=0 OR g.is_primary=0)`,
        )
        .bind(
          versionId,
          "name" in cmd.input ? cmd.input.name : null,
          "target" in cmd.input ? cmd.input.target?.amountMinor : null,
          "targetDate" in cmd.input ? cmd.input.targetDate : null,
          archive
            ? "Owner archived this goal"
            : "Owner revised the dated target",
          now,
          actor,
          goalId,
          household,
          cmd.expected,
          archive ? 1 : 0,
        ),
    );
    if (archive)
      batch.push(
        db
          .prepare(
            `UPDATE goals SET archived_at=? WHERE id=? AND household_id=? AND is_primary=0 AND EXISTS(SELECT 1 FROM goal_versions WHERE id=?)`,
          )
          .bind(now, goalId, household, versionId),
      );
  }
  // The mandatory FK rolls the entire batch back if a guarded insert lost a race.
  batch.push(
    db
      .prepare(
        `INSERT INTO goal_forecast_snapshots(id,household_id,goal_version_id,version,model_status,unit,methodology,created_at,created_by,immutable)
    VALUES(?,?,?,?,'not_configured',(SELECT target_unit FROM goal_versions WHERE id=?),'See owner outlook for dated target calculations.',?,?,1)`,
      )
      .bind(forecastId, household, versionId, revision, versionId, now, actor),
  );
  try {
    await db.batch(batch);
  } catch (error) {
    const won = await replay();
    if (won) return won;
    if (cmd.type === "patch") {
      const current = await getGoal(db, household, goalId);
      if (current?.revision !== cmd.expected)
        throw new GoalConflict(
          412,
          "stale_revision",
          "Reread the current goal before retrying.",
        );
      if (archive && current.primary)
        throw new GoalConflict(
          409,
          "primary_goal",
          "Select another primary goal before archiving this one.",
        );
    }
    throw error;
  }
  return goalReceipt.parse({ goalId, versionId, revision, actor });
}
