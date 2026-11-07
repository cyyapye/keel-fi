import { describe, expect, it } from "vitest";
import { HttpsSourceUrlSchema } from "./index";

const prefix = "https://example.com/";
const maximumLengthSource = prefix + "x".repeat(2_048 - prefix.length);

describe("HTTPS source links", () => {
  it("preserves complete HTTPS links through the allowed length boundary", () => {
    for (const value of [
      "https://example.com/source",
      "https://example.com:8443/source?document=synthetic#page-2",
      maximumLengthSource,
    ])
      expect(HttpsSourceUrlSchema.parse(value)).toBe(value);
  });

  it("rejects incomplete, unsafe, credential-bearing and overlong links without throwing", () => {
    for (const [reason, value] of [
      ["blank", ""],
      ["incomplete", "https://"],
      ["unencrypted", "http://example.com/source"],
      ["executable", "javascript:alert(1)"],
      ["username", "https://demo@example.com/source"],
      ["password", "https://:invalid@example.com/source"],
      ["overlong", maximumLengthSource + "x"],
    ])
      expect(HttpsSourceUrlSchema.safeParse(value).success, reason).toBe(false);
  });
});
