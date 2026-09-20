import { expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { Env } from "./types";
import { PositionPurchaseError } from "@keel/database";
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
});
