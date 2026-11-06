import { expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { Env } from "./types";
import {
  D1InvestmentPositionViewRepository,
  PositionPurchaseError,
} from "@keel/database";
import { legalDocumentTestDatabase } from "../../../scripts/test-support/legal-documents";
import { seedCostHoldings } from "../../../scripts/test-support/cost-fixtures";
import { seedPositionLinks } from "../../../scripts/seed-position-links";
import {
  PositionLinkReceiptSchema,
  PositionLinkWorkspaceSchema,
} from "@keel/domain/position-links";
const env = { ENVIRONMENT: "local" } as Env;
const input = {
  expectedSnapshotId: "snapshot",
  expectedReceiptId: null,
  details: { coversPosition: true, lots: [] },
};
it("validates optional purchase details and scopes accepted writes to the authenticated subject", async () => {
  const accept = vi.fn().mockResolvedValue({
    id: "receipt",
    positionId: "position",
    snapshotId: "snapshot",
    currency: "USD",
    details: { coversPosition: true, lots: [] },
    acceptedAt: "2026-09-01T00:00:00.000Z",
  });
  const app = createApp({ positionPurchaseRepository: { accept } });
  const post = (body: unknown) =>
    app.request(
      "/api/investment-positions/position/purchases",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
  expect((await post({ ...input, unknown: true })).status).toBe(400);
  expect(accept).not.toHaveBeenCalled();
  expect((await post(input)).status).toBe(201);
  expect(accept).toHaveBeenCalledWith(
    "synthetic-access-subject",
    "position",
    input,
  );
  accept.mockRejectedValue(
    new PositionPurchaseError("stale", "Reload purchase details."),
  );
  expect((await post(input)).status).toBe(409);
  const protectedResponse = await app.request(
    "/api/investment-positions/position/purchases",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    { ...env, ENVIRONMENT: "preview" },
  );
  expect(protectedResponse.status).not.toBe(201);
  const database = legalDocumentTestDatabase();
  try {
    await seedCostHoldings(database.asD1(), "synthetic-access-subject");
    const position = database.sqlite
      .prepare(
        "SELECT id FROM holding_positions WHERE household_id='hh_demo' LIMIT 1",
      )
      .get() as { id: string };
    const evidenceResponse = await app.request(
      `/api/investment-positions/${position.id}/share-price-evidence`,
      {},
      { ...env, DB: database.asD1() },
    );
    expect(evidenceResponse.status).toBe(200);
    expect(evidenceResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(await evidenceResponse.json()).toEqual({ prices: [], watch: [] });
    const current = (
      await new D1InvestmentPositionViewRepository(database.asD1()).list(
        "synthetic-access-subject",
      )
    ).connections
      .flatMap((connection) =>
        connection.containers.flatMap((c) => c.positions),
      )
      .find((p) => p.id === position.id)!;
    const valuation = {
      expectedSnapshotId: current.snapshot.id,
      expectedReceiptId: null,
      method: "total",
      record: {
        id: "gp",
        origin: "gp",
        totalMinor: 120000,
        priceMicros: 200000000,
        effectiveDate: "2026-09-01",
        priceDate: null,
        shareClass: null,
        carryStatus: "before_carry",
        sourceLabel: "Synthetic GP",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      },
    };
    const postValuation = (body: unknown, id = position.id) =>
      app.request(
        `/api/investment-positions/${id}/valuation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { ...env, DB: database.asD1() },
      );
    expect((await postValuation({ ...valuation, unknown: true })).status).toBe(
      400,
    );
    const acceptedValuation = await postValuation(valuation);
    expect(acceptedValuation.status).toBe(201);
    expect(acceptedValuation.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(await acceptedValuation.json()).toMatchObject({
      details: { valuation: { records: [valuation.record] } },
    });
    expect((await postValuation(valuation)).status).toBe(409);
    expect((await postValuation(valuation, "foreign-position")).status).toBe(
      404,
    );
    const historyUrl = `/api/investment-positions/${position.id}/history`;
    const history = await app.request(
      historyUrl,
      {},
      { ...env, DB: database.asD1() },
    );
    expect(history.status).toBe(200);
    expect(history.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await history.json()).toMatchObject({
      entries: [
        {
          kind: "investment",
          receipt: { details: { valuation: { records: [valuation.record] } } },
        },
      ],
      next: null,
    });
    expect(
      (
        await app.request(
          `${historyUrl}?date=invalid`,
          {},
          { ...env, DB: database.asD1() },
        )
      ).status,
    ).toBe(400);
    for (const path of [
      historyUrl,
      `/api/investment-positions/${position.id}/valuation`,
    ]) {
      const response = await app.request(
        path,
        path.endsWith("valuation")
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(valuation),
            }
          : {},
        { ...env, ENVIRONMENT: "preview", DB: database.asD1() },
      );
      expect(response.status).not.toBe(path.endsWith("valuation") ? 201 : 200);
    }
    expect(
      (
        await app.request(
          `/api/investment-positions/${position.id}/share-price-evidence`,
          {},
          { ...env, ENVIRONMENT: "preview", DB: database.asD1() },
        )
      ).status,
    ).not.toBe(200);
  } finally {
    database.sqlite.close();
  }
});

it("validates authenticated link decisions and reloads the saved current projection", async () => {
  const db = legalDocumentTestDatabase();
  const changes = () =>
    db.sqlite.prepare("SELECT total_changes() AS count").get()!.count;
  try {
    await seedPositionLinks(db.asD1());
    const seededChanges = changes();
    const app = createApp();
    const env = { ENVIRONMENT: "local", DB: db.asD1() } as Env;
    const get = await app.request("/api/investment-position-links", {}, env);
    expect(get.status).toBe(200);
    const w = PositionLinkWorkspaceSchema.parse(await get.json());
    expect(w.positions).toHaveLength(6);
    expect(w.links).toEqual([]);
    const source = w.positions.find(
      (p) => p.legalVehicleName === "Demo Atlas AI source",
    )!;
    const target = w.positions.find(
      (p) => p.legalVehicleName === "Demo Atlas II SPV",
    )!;
    const input = {
      sourcePositionId: source.id,
      targetPositionId: target.id,
      expectedSourceSnapshotId: source.snapshot.id,
      expectedTargetSnapshotId: target.snapshot.id,
      expectedSourceParticipationReviewId: null,
      expectedTargetParticipationReviewId: null,
      expectedReviewId: null,
      relationship: "same_investment",
      state: "linked",
      useSourceValue: true,
      note: "",
    };
    const request = (value: unknown, bindings = env) =>
      app.request(
        "/api/investment-position-links",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
        bindings,
      );
    expect((await request({ ...input, useSourceValue: "true" })).status).toBe(
      400,
    );
    expect(changes()).toBe(seededChanges);
    expect(
      (await request(input, { ...env, ENVIRONMENT: "production" })).status,
    ).toBe(401);
    expect(changes()).toBe(seededChanges);
    const accepted = await request(input);
    expect(accepted.status).toBe(201);
    const receipt = PositionLinkReceiptSchema.parse(await accepted.json());
    expect(receipt).toMatchObject({
      sourcePositionId: source.id,
      targetPositionId: target.id,
      relationship: "same_investment",
      state: "linked",
      useSourceValue: true,
      note: "",
    });
    const acceptedChanges = changes();
    expect(acceptedChanges).not.toBe(seededChanges);
    const loaded = await app.request("/api/investment-position-links", {}, env);
    const savedLinks = PositionLinkWorkspaceSchema.parse(
      await loaded.json(),
    ).links;
    expect(savedLinks).toHaveLength(1);
    expect(savedLinks).toEqual([receipt]);
    expect((await request(input)).status).toBe(409);
    expect(changes()).toBe(acceptedChanges);
    const legal = await app.request("/api/legal-entities", {}, env);
    expect(legal.status).toBe(200);
    const inventory = await legal.json<{
      candidates: { source: { id: string } }[];
      entities: { sources: { source: { id: string } }[] }[];
    }>();
    expect(
      [
        ...inventory.candidates,
        ...inventory.entities.flatMap((e) => e.sources),
      ].some((s) => s.source.id === source.id),
    ).toBe(true);
    const holdings = await app.request("/api/holdings-page", {}, env);
    expect(holdings.status).toBe(200);
    const body = await holdings.json<{
      holdings: { id: string; administratorNavMinor: number }[];
    }>();
    expect(body.holdings.some((p) => p.id === source.id)).toBe(false);
    expect(
      body.holdings.find((p) => p.id === target.id)?.administratorNavMinor,
    ).toBe(4_200_000);
  } finally {
    db.sqlite.close();
  }
});
