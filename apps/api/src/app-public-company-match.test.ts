import { expect, it, vi } from "vitest";
import {
  D1PublicCompanyLinkRepository,
  PublicCompanyLinkError,
} from "@keel/database";
import { createApp } from "./app";
import type { Env } from "./types";
it("authenticates issuer recommendations and approval and rejects stale or invalid decisions", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const match = {
    id,
    exposureId: "demo_public",
    status: "recommended",
    companyId: "demo_company",
    companyName: "Demo Issuer",
    reason: "The accepted issuer name matches.",
    sourceUrl: null,
    sourceTitle: "Accepted company names",
  };
  const recommend = vi
    .spyOn(D1PublicCompanyLinkRepository.prototype, "recommend")
    .mockResolvedValue(
      match as Awaited<ReturnType<D1PublicCompanyLinkRepository["recommend"]>>,
    );
  const approve = vi
    .spyOn(D1PublicCompanyLinkRepository.prototype, "approveRecommendation")
    .mockResolvedValue({
      id: "demo_receipt",
      exposureId: "demo_public",
      companyId: "demo_company",
      reviewedAt: "2026-09-24T12:00:00.000Z",
    });
  const app = createApp();
  const env = {
    DB: {},
    DOCUMENTS: {},
    INGESTION_QUEUE: {},
    ENVIRONMENT: "local",
  } as Env;
  try {
    const paths = [
      "/api/companies/public-links/demo_public/recommendation",
      `/api/companies/public-links/recommendations/${id}/approve`,
    ];
    for (const path of paths)
      expect(
        (
          await app.request(
            path,
            { method: "POST", headers: { Origin: "http://localhost" } },
            { ...env, ENVIRONMENT: "preview" },
          )
        ).status,
      ).toBe(401);
    expect(recommend).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    const response = await app.request(
      paths[0]!,
      { method: "POST", headers: { Origin: "http://localhost" } },
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(match);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(recommend).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "demo_public",
      expect.any(Function),
    );
    expect(
      (
        await app.request(
          paths[1]!,
          { method: "POST", headers: { Origin: "http://localhost" } },
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await app.request(
          "/api/companies/public-links/recommendations/invalid/approve",
          { method: "POST", headers: { Origin: "http://localhost" } },
          env,
        )
      ).status,
    ).toBe(400);
    approve.mockRejectedValueOnce(
      new PublicCompanyLinkError("stale", "Company evidence changed."),
    );
    expect(
      (
        await app.request(
          paths[1]!,
          { method: "POST", headers: { Origin: "http://localhost" } },
          env,
        )
      ).status,
    ).toBe(409);
  } finally {
    vi.restoreAllMocks();
  }
});
