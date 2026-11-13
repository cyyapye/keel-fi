import { prepareCostDatabaseSeed } from "./test-support/d1-cost";
import { preparePopulatedMigrationFixtureStore } from "./test-support/populated-migration";
const root = process.argv[2];
if (!root || process.argv.length !== 3)
  throw new Error("Pass one owned empty D1 seed directory");
await prepareCostDatabaseSeed(root);
const fixtures = process.env.KEEL_TEST_POPULATED_MIGRATION_FIXTURES;
if (fixtures !== undefined)
  await preparePopulatedMigrationFixtureStore(fixtures);
