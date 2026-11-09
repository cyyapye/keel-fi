import { expect } from "vitest";
import type { createApp } from "../../apps/api/src/app";
import type { Env } from "../../apps/api/src/types";
import {
  goalResource,
  goalReceipt,
  goalList,
  goalVersions,
} from "../../apps/api/src/agent-api/goals";
import { outlook } from "../../apps/api/src/agent-api/contract";
import {
  accountPage,
  positionDetail,
  positionPage,
  baselineDetail,
  citation,
} from "../../apps/api/src/agent-api/resources";
import type { measureD1 } from "./d1-meter";

type App = ReturnType<typeof createApp>;
export async function goalWorkflow(
  app: App,
  env: Env,
  headers: Record<string, string>,
  subject: string,
) {
  const writeEnv: Env = {
    ...env,
    AGENT_GOAL_WRITE_SERVICE_SUBJECT: subject,
    AGENT_GOAL_WRITE_HOUSEHOLD_ID: "hh_demo",
  };
  delete writeEnv.AGENT_READ_SERVICE_SUBJECT;
  const invoke = (
    method: string,
    path: string,
    body?: unknown,
    key?: string,
    revision?: number,
    e = writeEnv,
  ) =>
    app.request(
      "/api/v1/" + path,
      {
        method,
        headers: {
          ...headers,
          ...(key ? { "Idempotency-Key": key } : {}),
          ...(revision ? { "If-Match": `"${revision}"` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      e,
    );
  const today = new Date().toISOString().slice(0, 10);
  const makeDate = (years: number) =>
    Number(today.slice(0, 4)) +
    years +
    today.slice(4).replace(/02-29$/, "02-28");
  const target = {
    name: "Synthetic near-term target",
    metric: "net_worth",
    target: { amountMinor: 1000000, currency: "USD" },
    targetDate: makeDate(1),
  };
  expect(
    (await invoke("POST", "goals", target, "create", undefined, env)).status,
  ).toBe(403);
  expect((await invoke("POST", "goals", target)).status).toBe(400);
  const [first, duplicate] = await Promise.all([
    invoke("POST", "goals", target, "create"),
    invoke("POST", "goals", target, "create"),
  ]);
  expect([first.status, duplicate.status]).toEqual([201, 201]);
  const saved = goalReceipt.parse(await first.json());
  expect(await duplicate.json()).toEqual(saved);
  const path = "goals/" + saved.goalId;
  expect(first.headers.get("etag")).toBe('"1"');
  expect(
    (
      await invoke(
        "POST",
        "goals",
        { ...target, targetDate: makeDate(10) },
        "create",
      )
    ).status,
  ).toBe(409);
  const long = await invoke(
    "POST",
    "goals",
    { ...target, name: "Synthetic long-term target", targetDate: makeDate(10) },
    "long",
  );
  expect(long.status).toBe(201);
  const longId = goalReceipt.parse(await long.json()).goalId;
  const cash = await invoke(
    "POST",
    "goals",
    {
      name: "Synthetic reserve",
      metric: "liquidity_through_date",
      targetDate: makeDate(2),
    },
    "reserve",
  );
  const cashId = goalReceipt.parse(await cash.json()).goalId;
  async function activeOutlook() {
    const view = outlook.parse(await (await invoke("GET", "outlook")).json());
    let after = view.nextAfterGoal;
    while (after) {
      const more = outlook.parse(
        await (await invoke("GET", "outlook?afterGoal=" + after)).json(),
      );
      view.netWorthTargets.push(...more.netWorthTargets);
      view.liquidityTargets.push(...more.liquidityTargets);
      view.goals.push(...more.goals);
      after = more.nextAfterGoal;
    }
    return view;
  }
  const view = await activeOutlook();
  expect(view.netWorthTargets.map((t) => t.goalId)).toEqual(
    expect.arrayContaining([saved.goalId, longId]),
  );
  const runway = view.liquidityTargets.find((t) => t.goalId === cashId);
  expect(runway?.through).toBe(makeDate(2));
  expect(typeof runway?.lastsThroughDate).toBe("boolean");
  expect(view.goals.find((g) => g.goalId === saved.goalId)?.current).toBe(
    view.wealth.trackedNetWorthMinor,
  );
  expect(
    (await invoke("PATCH", path, { targetDate: makeDate(2) }, "change")).status,
  ).toBe(428);
  const changes = await Promise.all([
    invoke("PATCH", path, { targetDate: makeDate(2) }, "date", 1),
    invoke("PATCH", path, { name: "Concurrent update" }, "name", 1),
  ]);
  expect(changes.map((r) => r.status).sort()).toEqual([200, 412]);
  expect(changes.find((r) => r.status === 412)?.headers.get("link")).toContain(
    path,
  );
  const current = goalResource.parse(await (await invoke("GET", path)).json());
  expect(current.revision).toBe(2);
  const archive = await invoke(
    "PATCH",
    path,
    { status: "archived" },
    "archive",
    2,
  );
  expect(archive.status).toBe(200);
  const result = await archive.json();
  expect(
    await (
      await invoke("PATCH", path, { status: "archived" }, "archive", 2)
    ).json(),
  ).toEqual(result);
  expect(
    await (await invoke("POST", "goals", target, "create")).json(),
  ).toEqual(saved);
  const history = goalVersions.parse(
    await (await invoke("GET", path + "/versions")).json(),
  );
  expect(history.items.map((g) => [g.revision, g.status])).toEqual([
    [1, "active"],
    [2, "active"],
    [3, "archived"],
  ]);
  expect(
    goalResource.parse(await (await invoke("GET", path)).json()).status,
  ).toBe("archived");
  const archived = await allArchived();
  async function allArchived() {
    const records = [];
    let after: string | null = null;
    do {
      const p = goalList.parse(
        await (
          await invoke(
            "GET",
            "goals?status=archived" + (after ? "&after=" + after : ""),
          )
        ).json(),
      );
      records.push(...p.items);
      after = p.nextAfter;
    } while (after);
    return records;
  }
  expect(archived.map((g) => g.id)).toContain(saved.goalId);
  expect(
    (await activeOutlook()).goals.some((g) => g.goalId === saved.goalId),
  ).toBe(false);
  const other = { ...writeEnv, AGENT_GOAL_WRITE_HOUSEHOLD_ID: "api-other" };
  expect(
    (
      await invoke(
        "PATCH",
        "goals/" + longId,
        { name: "Foreign" },
        "foreign",
        1,
        other,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await invoke(
        "GET",
        "goals/" + longId,
        undefined,
        undefined,
        undefined,
        other,
      )
    ).status,
  ).toBe(404);
  expect((await invoke("POST", "../goals", target, "escape")).status).toBe(403);
}

export async function portfolioReads(
  app: App,
  env: Env,
  headers: Record<string, string>,
  meter: ReturnType<typeof measureD1>,
  baselineId: string,
) {
  const read = async (
    path: string,
    budget: number,
    roundTrips: number = 2,
    household = env.AGENT_READ_HOUSEHOLD_ID,
  ) => {
    meter.reset();
    const r = await app.request(
      "/api/v1/" + path,
      { headers },
      { ...env, AGENT_READ_HOUSEHOLD_ID: household },
    );
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.rowsRead, path).toBeLessThan(budget);
    expect(meter.cost.roundTrips, path).toBeLessThanOrEqual(roundTrips);
    return r;
  };
  const ids = new Set<string>();
  let after: string | null = null;
  let evidenceId: string | null = null;
  do {
    const page = positionPage.parse(
      await (
        await read(
          "positions" + (after ? "?after=" + encodeURIComponent(after) : ""),
          1300,
        )
      ).json(),
    );
    for (const p of page.items) {
      ids.add(p.id);
      evidenceId ??= p.evidenceId;
    }
    after = page.nextAfter;
  } while (after);
  expect(ids.size).toBeGreaterThanOrEqual(120);
  const path = "positions/" + ids.values().next().value!;
  expect(
    positionDetail.parse(await (await read(path, 90)).json()).id,
  ).toBeTruthy();
  expect((await read(path, 90, 2, "api-other")).status).toBe(404);
  const evidencePath = "evidence/" + encodeURIComponent(evidenceId!);
  expect(
    citation.parse(await (await read(evidencePath, 48)).json()).sourceType,
  ).toBe("document");
  expect((await read(evidencePath, 48, 2, "api-other")).status).toBe(404);
  const base = baselineDetail.parse(
    await (await read("baselines/" + baselineId, 10)).json(),
  );
  expect(base.otherLiquidMinor).toBe(100000);
  expect(
    accountPage.parse(
      await (await read("accounts?baselineId=" + baselineId, 190)).json(),
    ).items,
  ).toBeDefined();
  expect(
    (await read("accounts?baselineId=" + baselineId, 190, 2, "api-other"))
      .status,
  ).toBe(404);
  let cursor: string | null = null;
  const accounts = new Set<string>();
  do {
    const result = accountPage.parse(
      await (
        await read(
          "accounts" + (cursor ? "?after=" + encodeURIComponent(cursor) : ""),
          650,
          3,
        )
      ).json(),
    );
    for (const a of result.items) accounts.add(a.id);
    cursor = result.nextAfter;
  } while (cursor);
  expect(accounts.size).toBeGreaterThanOrEqual(120);
  const accountId = accounts.values().next().value!;
  expect((await read("accounts/" + accountId, 24)).status).toBe(200);
  expect((await read("accounts/" + accountId, 24, 2, "api-other")).status).toBe(
    404,
  );
  expect((await read("positions?after=bad", 10)).status).toBe(400);
}

// The existing outlook supports 512 decisions. Verify current debts and their
// source across repeated effective dates and an independently growing household.
export async function debtWorkflow(
  db: D1Database,
  app: App,
  env: Env,
  headers: Record<string, string>,
  meter: ReturnType<typeof measureD1>,
) {
  const offsets = JSON.stringify(Array.from({ length: 120 }, (_, i) => i + 1));
  async function addHistory(household: string, revision: number) {
    const p = household + "-debt-" + String(revision),
      stamp = "2026-01-01";
    await db.batch([
      db
        .prepare(
          `INSERT INTO liability_proposals(id,household_id,source,normalized_fingerprint,refresh_kind,observed_at,retrieved_at,status,created_at) VALUES(?,?,'manual',?,'manual',?,?,'pending_review',?)`,
        )
        .bind(p, household, "a".repeat(64), stamp, stamp, stamp),
      db
        .prepare(
          `INSERT INTO liability_proposal_rows(id,household_id,proposal_id,natural_key_sha256,source,institution_label,account_label,kind,classification,balance_minor,value_state,payment_minor,effective_date,observed_at,issues_json,created_at)
       SELECT ?||'-'||value,?,?,printf('%064x',value),'manual','Synthetic lender','Loan '||value,'mortgage','scheduled',10000+?, 'reported',10,?,?,'[]',? FROM json_each(?)`,
        )
        .bind(p, household, p, revision, stamp, stamp, stamp, offsets),
      db
        .prepare(
          `INSERT INTO liability_review_decisions(id,household_id,proposal_id,proposal_row_id,reviewer_user_id,decision,payment_treatment,change_note,decided_at,immutable)
       SELECT r.id,r.household_id,r.proposal_id,r.id,h.owner_user_id,'accepted','already_in_plan','Synthetic decision',?,1 FROM liability_proposal_rows r JOIN households h ON h.id=r.household_id WHERE r.proposal_id=?`,
        )
        .bind(stamp, p),
    ]);
  }
  const read = async (path: string) =>
    app.request("/api/v1/" + path, { headers }, env);
  await addHistory("hh_demo", 1);
  await addHistory("hh_demo", 2);
  await addHistory("api-other", 1);
  const { liabilityPage, liability } =
    await import("../../apps/api/src/agent-api/resources");
  let cursor: string | null = null;
  const distinct = new Set<string>();
  do {
    meter.reset();
    const page = liabilityPage.parse(
      await (
        await read("liabilities" + (cursor ? "?after=" + cursor : ""))
      ).json(),
    );
    expect(meter.cost).toMatchObject({ roundTrips: 2, rowsWritten: 0 });
    expect(meter.cost.rowsRead).toBeLessThan(1600);
    for (const d of page.items) {
      distinct.add(d.id);
      expect(d.balanceMinor).toBe(10002);
    }
    cursor = page.nextAfter;
  } while (cursor);
  expect(distinct.size).toBe(120);
  const one = liability.parse(
    await (await read("liabilities/" + distinct.values().next().value!)).json(),
  );
  const source = citation.parse(
    await (await read("evidence/" + one.evidenceId)).json(),
  );
  expect(source.sourceType).toBe("liability_review");
  await addHistory("hh_demo", 3);
  await addHistory("hh_demo", 4);
  await addHistory("hh_demo", 5);
  expect((await read("liabilities")).status).toBe(503);
}
