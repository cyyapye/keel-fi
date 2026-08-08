import { describe, expect, it } from "vitest";

import { accessIdentityFromPayload } from "./auth";

describe("Cloudflare Access identity", () => {
  it("maps a user token subject and optional email", () => {
    expect(
      accessIdentityFromPayload({
        sub: "synthetic-user-subject",
        email: "demo@example.invalid",
      }),
    ).toEqual({
      kind: "user",
      subject: "synthetic-user-subject",
      email: "demo@example.invalid",
    });
  });

  it("maps the bounded identity carried by a service-token JWT", () => {
    const commonName = `${"a".repeat(32)}.access`;

    expect(
      accessIdentityFromPayload({ sub: "", common_name: commonName }),
    ).toEqual({ kind: "service", subject: commonName, email: null });
  });

  it.each([
    { sub: "" },
    { sub: "", common_name: "not-a-service-token" },
    { common_name: `${"a".repeat(32)}.access` },
  ])("rejects an invalid machine identity payload %#", (payload) => {
    expect(() => accessIdentityFromPayload(payload)).toThrow(
      "Cloudflare Access identity is missing a subject.",
    );
  });
});
