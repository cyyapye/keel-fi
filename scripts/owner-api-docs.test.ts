import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { renderOwnerApiDocs } from "./owner-api-docs";

it("publishes the same v1 contract for people, agents, and the running API", async () => {
  for (const [path, expected] of Object.entries(await renderOwnerApiDocs()))
    expect(
      await readFile(path, "utf8"),
      path + " is stale; rerun pnpm docs:api",
    ).toBe(expected);
});
