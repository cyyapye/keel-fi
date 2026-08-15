import { describe, expect, it } from "vitest";

import {
  projectCashAccountIdentities,
  type AcceptedCashAccountHistoryRow,
} from "./cash-account-identity";

function row(
  input: Partial<AcceptedCashAccountHistoryRow> &
    Pick<
      AcceptedCashAccountHistoryRow,
      | "decision_id"
      | "natural_key_sha256"
      | "item_account_key_sha256"
      | "value_state"
      | "decided_at"
    >,
): AcceptedCashAccountHistoryRow {
  return {
    proposal_id: "cash_proposal_synthetic",
    connector_account_id: "cash_connection_synthetic",
    institution_label: "First Synthetic Bank",
    account_label: "Household checking",
    subtype: "checking",
    value_minor: input.value_state === "reported" ? 125_000 : null,
    balance_source: input.value_state === "reported" ? "available" : null,
    refresh_kind: "live",
    observed_at: input.decided_at,
    ...input,
  };
}

describe("cash account identity projection", () => {
  it("bridges a legacy natural account key to a later Item-scoped key", () => {
    const legacyKey = "a".repeat(64);
    const persistentKey = "b".repeat(64);
    const projection = projectCashAccountIdentities([
      row({
        decision_id: "cash_decision_legacy_reported",
        natural_key_sha256: legacyKey,
        item_account_key_sha256: null,
        value_state: "reported",
        refresh_kind: "initial",
        decided_at: "2026-08-14T18:00:00.000Z",
      }),
      row({
        decision_id: "cash_decision_current_reported",
        natural_key_sha256: persistentKey,
        item_account_key_sha256: legacyKey,
        value_state: "reported",
        decided_at: "2026-08-15T18:00:00.000Z",
      }),
      row({
        decision_id: "cash_decision_legacy_missing",
        natural_key_sha256: legacyKey,
        item_account_key_sha256: null,
        value_state: "not_reported",
        decided_at: "2026-08-15T18:00:00.000Z",
      }),
    ]);

    expect(projection.acceptedRows).toEqual([
      expect.objectContaining({
        canonicalNaturalKeySha256: legacyKey,
        row: expect.objectContaining({
          decision_id: "cash_decision_current_reported",
          value_state: "reported",
        }),
      }),
    ]);
  });

  it("does not merge same-name accounts without an exact key bridge", () => {
    const projection = projectCashAccountIdentities([
      row({
        decision_id: "cash_decision_first",
        natural_key_sha256: "a".repeat(64),
        item_account_key_sha256: null,
        value_state: "reported",
        decided_at: "2026-08-14T18:00:00.000Z",
      }),
      row({
        decision_id: "cash_decision_second",
        natural_key_sha256: "b".repeat(64),
        item_account_key_sha256: "c".repeat(64),
        value_state: "reported",
        decided_at: "2026-08-15T18:00:00.000Z",
      }),
    ]);

    expect(projection.acceptedRows).toHaveLength(2);
  });

  it("uses a reviewed link when the provider rotated every account key", () => {
    const priorKey = "a".repeat(64);
    const reportedKey = "b".repeat(64);
    const projection = projectCashAccountIdentities(
      [
        row({
          decision_id: "cash_decision_prior_reported",
          proposal_id: "cash_proposal_prior",
          natural_key_sha256: priorKey,
          item_account_key_sha256: priorKey,
          value_state: "reported",
          decided_at: "2026-08-14T18:00:00.000Z",
        }),
        row({
          decision_id: "cash_decision_prior_missing",
          proposal_id: "cash_proposal_rotation",
          natural_key_sha256: priorKey,
          item_account_key_sha256: null,
          value_state: "not_reported",
          decided_at: "2026-08-15T18:00:00.000Z",
        }),
        row({
          decision_id: "cash_decision_new_reported",
          proposal_id: "cash_proposal_rotation",
          natural_key_sha256: reportedKey,
          item_account_key_sha256: reportedKey,
          value_state: "reported",
          decided_at: "2026-08-15T18:00:00.000Z",
        }),
      ],
      [],
      [
        {
          connectorAccountId: "cash_connection_synthetic",
          naturalKeyLowSha256: priorKey,
          naturalKeyHighSha256: reportedKey,
        },
      ],
    );

    expect(projection.acceptedRows).toEqual([
      expect.objectContaining({
        canonicalNaturalKeySha256: priorKey,
        row: expect.objectContaining({
          decision_id: "cash_decision_new_reported",
          value_state: "reported",
        }),
      }),
    ]);
  });

  it("keeps exact keys scoped to their connected institution", () => {
    const sharedKey = "d".repeat(64);
    const projection = projectCashAccountIdentities([
      row({
        decision_id: "cash_decision_first_connection",
        connector_account_id: "cash_connection_first",
        natural_key_sha256: sharedKey,
        item_account_key_sha256: null,
        value_state: "reported",
        decided_at: "2026-08-14T18:00:00.000Z",
      }),
      row({
        decision_id: "cash_decision_second_connection",
        connector_account_id: "cash_connection_second",
        natural_key_sha256: "e".repeat(64),
        item_account_key_sha256: sharedKey,
        value_state: "reported",
        decided_at: "2026-08-15T18:00:00.000Z",
      }),
    ]);

    expect(projection.acceptedRows).toHaveLength(2);
  });
});
