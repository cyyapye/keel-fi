import { test } from "./api-mocked-test";
import {
  isolateMaintenanceExample,
  manualHoldingRecovery,
  linkAndReplacePosition,
  correctInvestmentAndDistributions,
  acceptFeeAndCarryTerms,
} from "./holding-maintenance-catalogue.cases";

test.describe("Holding maintenance", () => {
  test.beforeEach(isolateMaintenanceExample);
  test(
    "manual holding recovery opens the committed position or retries only after checking for it",
    manualHoldingRecovery,
  );
  test(
    "linked reports can supply value while a replacement stays historical",
    linkAndReplacePosition,
  );
  test(
    "a purchase correction preserves distributions and saved distributions reload without another write",
    correctInvestmentAndDistributions,
  );
  test(
    "fee and carry corrections reopen on the same USD investment with its distributions intact",
    acceptFeeAndCarryTerms,
  );
});
