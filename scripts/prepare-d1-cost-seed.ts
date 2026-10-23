import { prepareCostDatabaseSeed } from "./test-support/d1-cost";
const root = process.argv[2];
if (!root || process.argv.length !== 3)
  throw new Error("Pass one owned empty D1 seed directory");
await prepareCostDatabaseSeed(root);
