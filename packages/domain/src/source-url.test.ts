import { describe, expect, it } from "vitest";
import { HttpsSourceUrlSchema } from "./index";

describe("HTTPS source links", () => {
  it.each([
    "",
    "h",
    "ht",
    "htt",
    "http",
    "https",
    "https:",
    "https:/",
    "https://",
    "https://[",
    "https://example.com:invalid",
    "not a URL",
    "http://example.com/source",
    "ftp://example.com/source",
    "javascript:alert(1)",
    "https://demo:invalid@example.com/source",
    "https://demo@example.com/source",
    `https://example.com/${"x".repeat(2_048)}`,
  ])("rejects invalid or disallowed input without throwing: %j", (value) => {
    expect(HttpsSourceUrlSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    "https://example.com/source",
    "https://example.com/source?document=synthetic#page-2",
    "https://example.com:8443/source",
  ])("accepts a complete HTTPS source link: %s", (value) => {
    expect(HttpsSourceUrlSchema.parse(value)).toBe(value);
  });
});
