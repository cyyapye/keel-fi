import { expect, it } from "vitest";
import { createApp } from "./app";
import type { Env } from "./types";
import { legalDocumentTestDatabase } from "../../../scripts/test-support/legal-documents";
import { seedPositionLinks } from "../../../scripts/seed-position-links";
import { PositionLinkWorkspaceSchema } from "@keel/domain/position-links";

it("validates authenticated link decisions and reloads the saved current projection", async () => {
  const db = legalDocumentTestDatabase();
  try {
    await seedPositionLinks(db.asD1());
    const app = createApp();
    const env = { ENVIRONMENT: "local", DB: db.asD1() } as Env;
    const get = await app.request("/api/investment-position-links", {}, env);
    expect(get.status).toBe(200);
    const w = PositionLinkWorkspaceSchema.parse(await get.json());
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
    expect(
      (await request(input, { ...env, ENVIRONMENT: "production" })).status,
    ).toBe(401);
    const accepted = await request(input);
    expect(accepted.status).toBe(201);
    const loaded = await app.request("/api/investment-position-links", {}, env);
    expect(
      PositionLinkWorkspaceSchema.parse(await loaded.json()).links,
    ).toHaveLength(1);
    expect((await request(input)).status).toBe(409);
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
