import { describe, expect, it } from "vitest";

import {
  filterAngelListStorageState,
  keelOrigin,
  setupKeelUrl,
} from "./angellist-browser-session-lib";

const cookie = {
  name: "synthetic_session",
  value: "synthetic-only",
  domain: ".angellist.com",
  path: "/",
  expires: 2_000_000_000,
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
};

describe("AngelList browser session setup", () => {
  it("retains only secure AngelList state", () => {
    expect(
      filterAngelListStorageState({
        cookies: [
          cookie,
          { ...cookie, domain: ".example.com", name: "outside" },
          { ...cookie, secure: false, name: "insecure" },
        ],
        origins: [
          {
            origin: "https://venture.angellist.com",
            localStorage: [{ name: "synthetic", value: "yes" }],
          },
          {
            origin: "https://example.com",
            localStorage: [{ name: "outside", value: "no" }],
          },
        ],
      }),
    ).toEqual({
      cookies: [cookie],
      origins: [
        {
          origin: "https://venture.angellist.com",
          localStorage: [{ name: "synthetic", value: "yes" }],
        },
      ],
    });
  });

  it("accepts only a bare HTTPS Keel origin", () => {
    expect(keelOrigin("https://keel.example")).toBe("https://keel.example");
    expect(() => keelOrigin("https://keel.example/path")).toThrow(
      "one HTTPS origin",
    );
    expect(() => keelOrigin("http://keel.example")).toThrow("one HTTPS origin");
    expect(setupKeelUrl(["--", "--keel-url", "https://keel.example"])).toBe(
      "https://keel.example",
    );
  });
});
