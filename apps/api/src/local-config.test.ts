import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("local API configuration", () => {
  it("provides deterministic synthetic material for protected identities", () => {
    const config = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    const localStart = config.indexOf('"local": {');
    const localBindingsEnd = config.indexOf('"d1_databases":', localStart);
    expect(localStart).toBeGreaterThan(-1);
    expect(localBindingsEnd).toBeGreaterThan(localStart);

    const localBindings = config.slice(localStart, localBindingsEnd);
    const key = /"CONNECTOR_CREDENTIAL_KEY":\s*"([A-Za-z0-9_-]+)"/u.exec(
      localBindings,
    )?.[1];
    expect(key).toBeDefined();
    expect(Buffer.from(key ?? "", "base64url")).toHaveLength(32);

    const productionConfig = config.slice(0, localStart);
    expect(productionConfig).not.toContain('"CONNECTOR_CREDENTIAL_KEY"');
  });
});
