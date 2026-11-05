import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { LegalEntityRecord } from "@keel/domain/legal-entities";
import {
  familyHoldingsProfile,
  historicalTrustProfile,
  studioProfile,
} from "../../../e2e/legal-entity-profile-fixtures";
import { SavedEntityProfile } from "./LegalEntities";

function profileLines(entity: LegalEntityRecord) {
  const markup = renderToStaticMarkup(<SavedEntityProfile entity={entity} />);
  expect(markup).not.toMatch(/<dt\b/u);
  return markup
    .replaceAll("</p>", "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/\n$/u, "")
    .split("\n");
}

test("displays recorded zero interest and omits absent profile facts", () => {
  expect(profileLines(familyHoldingsProfile)).toEqual([
    "Ownership entity",
    "Demo Operator · 100%",
    "Delaware, US · Mar 12, 2024",
    "Partnership",
    "EIN ending ••-•••4821",
    "Synthetic entity prepared for counsel review.",
  ]);
  expect(
    profileLines({
      ...studioProfile,
      ownershipInterestPpm: 0,
      interestStatus: "unknown",
    }),
  ).toEqual(["Operating entity", "0%", "California, US"]);
});

test("keeps historical trust ownership distinct from zero interest", () => {
  expect(profileLines(historicalTrustProfile)).toEqual([
    "Ownership entity · Trust",
    "Demo International Family Trust Administration Company",
    "Historical",
    "Mar 12, 2024",
  ]);
  expect(
    profileLines({ ...historicalTrustProfile, currentOwner: null }),
  ).toEqual(["Ownership entity · Trust", "Historical", "Mar 12, 2024"]);
});
