import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";

const manifest = z
  .object({
    version: z.literal(1),
    baselineRevision: z.string().regex(/^[a-f0-9]{40}$/),
    baselineBrowserInventorySha256: z.string().regex(/^[a-f0-9]{64}$/),
    baselineBrowserCases: z.number().int().positive(),
    retiredBrowserCaseCount: z.number().int().positive(),
    addedBrowserCases: z.array(z.string()).nonempty(),
    requiredPdfFlow: z.literal("pdf-isolation"),
    migrations: z
      .array(
        z
          .object({
            id: z.string().min(1),
            retiredBrowserCases: z.array(z.string()),
            unitCases: z.array(z.string()).nonempty(),
            browserCases: z.array(z.string()).nonempty(),
            assertions: z.string().min(30),
          })
          .strict(),
      )
      .nonempty(),
  })
  .strict()
  .parse(JSON.parse(readFileSync(".tugling/test-layering.json", "utf8")));
const inventory = z
  .object({
    vitest: z.array(z.string()),
    playwright: z.array(z.string()),
    exclusions: z.array(z.object({ id: z.string() })),
  })
  .parse(JSON.parse(readFileSync(".tugling/pilot-cases.json", "utf8")));

function verifyCoverage(current: typeof inventory) {
  const excluded = new Set(current.exclusions.map((entry) => entry.id));
  const retired = manifest.migrations.flatMap(
    (entry) => entry.retiredBrowserCases,
  );
  if (
    new Set(retired).size !== manifest.retiredBrowserCaseCount ||
    retired.length !== manifest.retiredBrowserCaseCount
  )
    throw new Error("Every retired browser case requires one migration record");
  for (const entry of manifest.migrations) {
    for (const id of entry.unitCases)
      if (!current.vitest.includes(id) || excluded.has(id))
        throw new Error(`Missing executable replacement: ${id}`);
    for (const id of entry.browserCases)
      if (!current.playwright.includes(id) || excluded.has(id))
        throw new Error(`Missing executable browser boundary: ${id}`);
    for (const id of entry.retiredBrowserCases)
      if (current.playwright.includes(id))
        throw new Error(`Retired case duplicated: ${id}`);
  }
  for (const id of manifest.addedBrowserCases)
    if (!current.playwright.includes(id))
      throw new Error(`Missing replacement browser identity: ${id}`);
}

test("every migrated policy keeps executable replacements and real browser/PDF boundaries", () => {
  verifyCoverage(inventory);
  const verification = z
    .object({
      flows: z.array(z.object({ id: z.string(), argv: z.array(z.string()) })),
    })
    .parse(
      JSON.parse(readFileSync(".tugling/pilot-verification.json", "utf8")),
    );
  expect(
    verification.flows.find((flow) => flow.id === manifest.requiredPdfFlow)
      ?.argv,
  ).toEqual(["make", "pdf-sandbox-verify"]);
});

test("coverage accounting rejects missing or excluded replacement and browser cases", () => {
  for (const kind of ["unit", "browser"] as const) {
    const id =
      kind === "unit"
        ? manifest.migrations[0]!.unitCases[0]!
        : manifest.migrations[0]!.browserCases[0]!;
    const key = kind === "unit" ? "vitest" : "playwright";
    expect(() =>
      verifyCoverage({
        ...inventory,
        [key]: inventory[key].filter((item) => item !== id),
      }),
    ).toThrow("Missing executable");
    expect(() =>
      verifyCoverage({
        ...inventory,
        exclusions: [...inventory.exclusions, { id }],
      }),
    ).toThrow("Missing executable");
  }
});
