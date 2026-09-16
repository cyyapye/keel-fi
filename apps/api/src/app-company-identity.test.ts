import { expect, it, vi } from "vitest";
import {
  CompanyIdentityError,
  type CompanyIdentityRepository,
} from "@keel/database";
import { createApp } from "./app";
import type { Env } from "./types";
const env = {
  DB: {},
  DOCUMENTS: {},
  INGESTION_QUEUE: {},
  ENVIRONMENT: "local",
} as Env;
const proposal = {
  companyId: "synthetic-main",
  sourceCompanyId: "synthetic-inc",
  aliasName: "Synthetic Cedar Inc.",
};
const preview = {
  ...proposal,
  revision: "a".repeat(64),
  companyName: "Synthetic Cedar",
  sourceCompanyName: proposal.aliasName,
  aliases: [proposal.aliasName],
  positions: [],
};
const input = {
  ...proposal,
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: preview.revision,
  reason: "Reviewed synthetic name.",
};
it("authenticates company identity reads and writes, validates boundaries and returns stale conflicts", async () => {
  const repository = {
    getCatalog: vi
      .fn()
      .mockResolvedValue({ revision: 1, companies: [], suggestedGroups: [] }),
    preview: vi.fn().mockResolvedValue(preview),
    review: vi.fn().mockResolvedValue({
      ...preview,
      id: "22222222-2222-4222-8222-222222222222",
      requestId: input.requestId,
      reason: input.reason,
      recordedAt: "2026-09-01T12:00:00.000Z",
    }),
  } satisfies CompanyIdentityRepository;
  const app = createApp({ companyIdentityRepository: repository });
  const read = await app.request("/api/companies/identity", {}, env);
  expect(read.status).toBe(200);
  expect(read.headers.get("Cache-Control")).toBe("private, no-store");
  for (const [path, body] of [
    ["aliases/preview", proposal],
    ["aliases", input],
  ] as const) {
    expect(
      (
        await app.request(
          `/api/companies/${path}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          env,
        )
      ).status,
    ).toBe(path === "aliases" ? 201 : 200);
    expect(
      (
        await app.request(
          `/api/companies/${path}`,
          { method: "POST", body: "{}" },
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/companies/${path}`,
          { method: "POST", body: JSON.stringify(body) },
          { ...env, ENVIRONMENT: "preview" },
        )
      ).status,
    ).toBe(401);
  }
  expect(
    (
      await app.request(
        "/api/companies/identity",
        {},
        { ...env, ENVIRONMENT: "preview" },
      )
    ).status,
  ).toBe(401);
  expect(repository.review).toHaveBeenCalledWith(
    "synthetic-access-subject",
    input,
  );
  repository.review.mockRejectedValueOnce(
    new CompanyIdentityError("stale", "Review changed company names."),
  );
  expect(
    (
      await app.request(
        "/api/companies/aliases",
        { method: "POST", body: JSON.stringify(input) },
        env,
      )
    ).status,
  ).toBe(409);
});
