import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildRecordedSeed } from "./seed-position-links";
import { seedClosingPrice } from "./seed-closing-price";

const root = resolve(process.argv[2] ?? "");
if (root !== resolve(".keel-local/scenarios/pre-distribution"))
  throw new Error("Use the dedicated synthetic pre-distribution scenario.");
writeFileSync(
  join(root, "pre-distribution.sql"),
  await buildRecordedSeed(async (db) => {
    await seedClosingPrice(db, true);
  }),
);
