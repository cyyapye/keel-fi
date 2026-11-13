import type { AlphaRepository } from "@keel/database";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import { isAllowedBrowserWrite } from "./browser-write-request";

const origin = "https://keel.example.invalid";
const path = "/api/holding-imports/synthetic-import/reconcile";

describe("browser write origin boundary", () => {
  it("rejects untrusted browser writes before changing repository state in local and Access modes", async () => {
    const reconcileHoldingImport = vi
      .fn()
      .mockResolvedValue({ reviewed: true });
    const app = createApp({
      verifyAccess: () =>
        Promise.resolve({
          kind: "user",
          subject: "synthetic-owner",
          email: null,
        }),
      repository: { reconcileHoldingImport } as unknown as AlphaRepository,
    });
    const deniedHeaders: Record<string, string>[] = [
      {},
      { Origin: "null" },
      { Origin: "not-an-origin" },
      { Origin: "https://other.example.invalid" },
      { Origin: "https://sibling.keel.example.invalid" },
      { Origin: "https://keel.example.invalid.attacker.invalid" },
      { Origin: "http://keel.example.invalid" },
      { Origin: "https://keel.example.invalid:8443" },
      { Origin: `${origin}, ${origin}` },
      { Origin: origin + "/" },
      { Origin: origin, "Sec-Fetch-Site": "cross-site" },
      { Origin: origin, "Sec-Fetch-Site": "same-site" },
      { Origin: origin, "Sec-Fetch-Site": "none" },
      { Referer: "https://other.example.invalid/form" },
      { Referer: "malformed" },
      {
        "Sec-Fetch-Site": "same-origin",
        Referer: "https://other.example.invalid/",
      },
      { Authorization: "Bearer arbitrary", "Content-Type": "application/json" },
    ];
    for (const mode of ["local", "preview"] as const) {
      for (const headers of deniedHeaders) {
        for (const contentType of [
          "text/plain",
          "application/x-www-form-urlencoded",
        ]) {
          const response = await app.request(
            origin + path,
            {
              method: "POST",
              headers: {
                "Content-Type": contentType,
                ...headers,
                ...(mode === "preview"
                  ? { "Cf-Access-Jwt-Assertion": "synthetic" }
                  : {}),
              },
              body: "{}",
            },
            { ENVIRONMENT: mode },
          );
          expect(response.status).toBe(403);
          expect(response.headers.get("Cache-Control")).toBe("no-store");
          expect(reconcileHoldingImport).not.toHaveBeenCalled();
        }
      }
      const bodyless = await app.request(
        origin + path,
        {
          method: "POST",
          headers:
            mode === "preview"
              ? { "Cf-Access-Jwt-Assertion": "synthetic" }
              : {},
        },
        { ENVIRONMENT: mode },
      );
      expect(bodyless.status).toBe(403);
      expect(reconcileHoldingImport).not.toHaveBeenCalled();
    }
  });

  it("allows same-origin browser evidence for bodyless, JSON and multipart writes", async () => {
    const reconcileHoldingImport = vi
      .fn()
      .mockResolvedValue({ reviewed: true });
    const app = createApp({
      verifyAccess: () =>
        Promise.resolve({
          kind: "user",
          subject: "synthetic-owner",
          email: null,
        }),
      repository: { reconcileHoldingImport } as unknown as AlphaRepository,
    });
    const multipart = new FormData();
    multipart.set("file", new File(["synthetic"], "synthetic.txt"));
    const inputs: RequestInit[] = [
      { headers: { Origin: origin } },
      {
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      },
      {
        headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" },
        body: multipart,
      },
      { headers: { Referer: origin + "/holdings" } },
      { headers: { "Sec-Fetch-Site": "same-origin" } },
    ];
    for (const input of inputs) {
      const response = await app.request(
        origin + path,
        {
          ...input,
          method: "POST",
          headers: { ...input.headers, "Cf-Access-Jwt-Assertion": "synthetic" },
        },
        { ENVIRONMENT: "preview" },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reviewed: true });
    }
    expect(reconcileHoldingImport).toHaveBeenCalledTimes(inputs.length);
    expect(reconcileHoldingImport).toHaveBeenLastCalledWith(
      "synthetic-owner",
      "synthetic-import",
    );
  });

  it("keeps safe methods passive and requires origin evidence for every unsafe method", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        isAllowedBrowserWrite(
          new Request(origin + path, {
            method,
            headers: {
              Origin: "https://other.example.invalid",
              "Sec-Fetch-Site": "cross-site",
            },
          }),
        ),
      ).toBe(true);
    }
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(
        isAllowedBrowserWrite(new Request(origin + path, { method })),
      ).toBe(false);
      expect(
        isAllowedBrowserWrite(
          new Request(origin + path, { method, headers: { Origin: origin } }),
        ),
      ).toBe(true);
    }
  });
});
