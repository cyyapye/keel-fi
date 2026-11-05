import { expect, test } from "vitest";
import type { PositionLinkWorkspace } from "../packages/domain/src/position-links";
import { positionLinkSuggestionFixture } from "./test-support/position-link-suggestion";
import { suggestPositionLink } from "../apps/web/src/position-link-suggestion";

type Position = PositionLinkWorkspace["positions"][number];
function fixture() {
  const { availablePositions, unrelatedPositions } =
    positionLinkSuggestionFixture();
  const [older, newer] = availablePositions as [Position, Position];
  const suggest = (positions: Position[], current = newer.id) =>
    suggestPositionLink(
      { positions: [...positions, ...unrelatedPositions], links: [] },
      current,
    );
  return { older, newer, suggest };
}

for (const mismatch of [
  "different account",
  "missing account",
  "different owner",
  "different date",
  "missing company",
  "different currency",
  "different status",
  "different company",
  "different vehicle",
  "different kind",
  "missing name",
  "same observation time",
] as const) {
  test(`suggestion rejects ${mismatch} among 120 unrelated positions`, () => {
    const { older, newer, suggest } = fixture();
    const changed = { ...older };
    switch (mismatch) {
      case "different account":
        changed.ownershipContainerId = "synthetic-other-account";
        // With just one candidate, ambiguity cannot disguise a missed account check.
        expect(
          suggestPositionLink(
            { positions: [changed, newer], links: [] },
            newer.id,
          ),
        ).toBeNull();
        break;
      case "missing account":
        delete changed.ownershipContainerId;
        break;
      case "different owner":
        changed.ownerLabel = "Synthetic Other Owner";
        break;
      case "different date":
        changed.openedOn = "2024-07-10";
        break;
      case "missing company":
        changed.companyReview = null;
        break;
      case "different currency":
        changed.snapshot = { ...older.snapshot, currency: "EUR" };
        break;
      case "different status":
        changed.snapshot = { ...older.snapshot, providerStatus: "live" };
        break;
      case "different company":
        changed.companyReview = {
          ...older.companyReview!,
          companyId: "synthetic-other-company",
        };
        break;
      case "different vehicle":
        changed.legalVehicleName = "Synthetic Different Vehicle LLC";
        break;
      case "different kind":
        changed.kind = "direct";
        break;
      case "missing name":
        changed.reportedExposureName = null;
        break;
      case "same observation time":
        changed.snapshot = {
          ...older.snapshot,
          observedAt: newer.snapshot.observedAt,
        };
        break;
    }
    expect(suggest([changed, newer])).toBeNull();
  });
}

test("only a unique pair is suggested, without mutating records or accepting a link", () => {
  const { older, newer, suggest } = fixture();
  const before = structuredClone([older, newer]);
  expect(suggest([older, newer])).toEqual({
    targetId: older.id,
    sourceId: newer.id,
    relationship: "company_renamed",
  });
  expect([older, newer]).toEqual(before);
  expect(
    suggest([older, newer, { ...older, id: "synthetic-third-match" }]),
  ).toBeNull();
  expect(suggest([newer])).toBeNull();
  expect(suggest([older, newer], "missing")).toBeNull();
});

test("same-name duplicates infer the same-investment relationship", () => {
  const { older, newer, suggest } = fixture();
  expect(
    suggest([
      older,
      { ...newer, reportedExposureName: older.reportedExposureName },
    ]),
  ).toEqual({
    targetId: older.id,
    sourceId: newer.id,
    relationship: "same_investment",
  });
});

test("reviewed contribution evidence wins over the earlier observation in either direction", () => {
  const { older, newer, suggest } = fixture();
  const receipt = {
    ...older.purchaseReceipt!,
    positionId: newer.id,
    snapshotId: newer.snapshot.id,
  };
  const pair = [
    { ...older, purchaseReceipt: null },
    { ...newer, purchaseReceipt: receipt },
  ];
  for (const current of [older.id, newer.id])
    expect(suggest(pair, current)).toEqual({
      targetId: newer.id,
      sourceId: older.id,
      relationship: "company_renamed",
    });
  expect(suggest([{ ...older, purchaseReceipt: null }, newer])).toEqual({
    targetId: older.id,
    sourceId: newer.id,
    relationship: "company_renamed",
  });
});

function historical() {
  const { older, newer, suggest } = fixture();
  const retained: Position = {
    ...older,
    ownershipContainerId: "synthetic-history-container",
    sourceProvider: "angellist",
    reviewedHistory: true,
    companyReview: null,
  };
  const current: Position = {
    ...newer,
    sourceProvider: "angellist",
    reviewedHistory: false,
    companyReview: null,
  };
  return { retained, current, suggest };
}

test("retained history suggests the current account without inventing missing identity", () => {
  const { retained, current, suggest } = historical();
  const before = structuredClone([retained, current]);
  expect(suggest([retained, current])).toEqual({
    targetId: current.id,
    sourceId: retained.id,
    relationship: "company_renamed",
  });
  expect([retained, current]).toEqual(before);
  expect(
    suggest([
      retained,
      { ...retained, id: "synthetic-ambiguous-history" },
      current,
    ]),
  ).toBeNull();
});

test.each([
  { sourceProvider: "sydecar" as const },
  { reviewedHistory: false },
  { ownerLabel: "Synthetic Other Owner" },
  { openedOn: "2024-07-10" },
])("retained history rejects mismatched identity: %j", (mismatch) => {
  const { retained, current, suggest } = historical();
  expect(suggest([{ ...retained, ...mismatch }, current])).toBeNull();
});
