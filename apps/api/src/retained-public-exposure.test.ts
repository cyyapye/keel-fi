import { createHash } from "node:crypto";
import type {
  RetainedProviderExposureEvidenceInput,
  RetainedPublicExposureEvidenceInput,
  RetainedStructuredAssetExposureEvidenceInput,
} from "@keel/database";
import { describe, expect, it, vi } from "vitest";

import { D1RetainedPublicExposureReconciler } from "./retained-public-exposure";
import type { Env } from "./types";

const credentialKey = btoa("k".repeat(32))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/u, "");

function sourceResponse(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      accounts: [
        {
          account_id: "synthetic-brokerage",
          persistent_account_id: "synthetic-brokerage-persistent",
          name: "Synthetic brokerage",
          official_name: null,
          subtype: "brokerage",
          type: "investment",
        },
        {
          account_id: "synthetic-ira",
          persistent_account_id: "synthetic-ira-persistent",
          name: "Synthetic IRA",
          official_name: null,
          subtype: "ira",
          type: "investment",
        },
      ],
      holdings: [
        {
          account_id: "synthetic-brokerage",
          security_id: "synthetic-strong-security",
          institution_value: "100.00",
          cost_basis: "80.00",
          quantity: "1.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-ira",
          security_id: "synthetic-strong-security",
          institution_value: "200.00",
          cost_basis: "160.00",
          quantity: "2.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-brokerage",
          security_id: "synthetic-ticker-only-security",
          institution_value: "50.00",
          cost_basis: null,
          quantity: "1.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-ira",
          security_id: "synthetic-ticker-only-security",
          institution_value: "75.00",
          cost_basis: null,
          quantity: "1.5",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-brokerage",
          security_id: "synthetic-cash-security",
          institution_value: "25.00",
          cost_basis: null,
          quantity: "25.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-ira",
          security_id: "synthetic-cash-security",
          institution_value: "15.00",
          cost_basis: null,
          quantity: "15.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "synthetic-brokerage",
          security_id: "synthetic-crypto-security",
          institution_value: "5.00",
          cost_basis: "4.00",
          quantity: "10.0",
          institution_price_as_of: "2026-08-15",
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      ],
      securities: [
        {
          security_id: "synthetic-strong-security",
          name: "Synthetic Semiconductor Security",
          ticker_symbol: "SYN",
          type: "equity",
          cusip: "67066G104",
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          security_id: "synthetic-ticker-only-security",
          name: "Synthetic Ticker-only Security",
          ticker_symbol: "TXT",
          type: "equity",
          cusip: null,
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          security_id: "synthetic-cash-security",
          name: "Synthetic Cash",
          ticker_symbol: null,
          type: "cash",
          cusip: null,
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          security_id: "synthetic-crypto-security",
          name: "Synthetic Coin",
          ticker_symbol: "SCOIN",
          type: "cryptocurrency",
          cusip: null,
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      ],
      item: {
        institution_id: "ins_synthetic",
        item_id: "item_synthetic",
      },
      request_id: "request_synthetic",
    }),
  );
}

function repository() {
  return {
    listRetainedPublicExposureDocuments: vi.fn(),
    recordRetainedPublicExposureDocumentFailures: vi
      .fn()
      .mockResolvedValue(undefined),
    recordRetainedPublicExposureEvidence: vi.fn().mockResolvedValue(undefined),
    recordRetainedProviderExposureEvidence: vi
      .fn()
      .mockResolvedValue(undefined),
    recordRetainedStructuredAssetExposureEvidence: vi
      .fn()
      .mockResolvedValue(undefined),
    reconcileAcceptedPublicExposureHistory: vi
      .fn()
      .mockResolvedValue(undefined),
  };
}

describe("retained public exposure reconciliation", () => {
  it("uses global identity first and scopes provider identity to one Item", async () => {
    const bytes = sourceResponse();
    const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");
    const source = repository();
    source.listRetainedPublicExposureDocuments.mockResolvedValue([
      {
        importId: "import_synthetic_retained",
        objectKey: "holding-imports/synthetic-retained.json",
        byteSize: bytes.byteLength,
        evidenceSha256,
        rows: [
          { importRowId: "row_synthetic_brokerage", sourceRowNumber: 1 },
          { importRowId: "row_synthetic_ira", sourceRowNumber: 2 },
          {
            importRowId: "row_synthetic_ticker_only_brokerage",
            sourceRowNumber: 3,
          },
          {
            importRowId: "row_synthetic_ticker_only_ira",
            sourceRowNumber: 4,
          },
          {
            importRowId: "row_synthetic_cash_brokerage",
            sourceRowNumber: 5,
          },
          { importRowId: "row_synthetic_cash_ira", sourceRowNumber: 6 },
          { importRowId: "row_synthetic_crypto", sourceRowNumber: 7 },
        ],
      },
    ]);
    const env = {
      CONNECTOR_CREDENTIAL_KEY: credentialKey,
      DOCUMENTS: {
        get: vi.fn().mockResolvedValue({
          size: bytes.byteLength,
          arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
        }),
      },
    } as unknown as Env;

    const result = await new D1RetainedPublicExposureReconciler(
      env,
      source,
    ).reconcile("synthetic-access-subject");

    expect(result).toEqual({
      documentCount: 1,
      skippedDocumentCount: 0,
      identityCount: 7,
    });
    const recorded = source.recordRetainedPublicExposureEvidence.mock
      .calls[0]![1] as readonly RetainedPublicExposureEvidenceInput[];
    expect(recorded).toHaveLength(7);
    expect(recorded.map((row) => row.importRowId)).toEqual([
      "row_synthetic_brokerage",
      "row_synthetic_ira",
      "row_synthetic_ticker_only_brokerage",
      "row_synthetic_ticker_only_ira",
      "row_synthetic_cash_brokerage",
      "row_synthetic_cash_ira",
      "row_synthetic_crypto",
    ]);
    const strongEvidence = recorded.filter(
      (row) => row.resolutionStatus === "strong_identifier",
    );
    expect(
      new Set(strongEvidence.map((row) => row.protectedIdentityKey)).size,
    ).toBe(1);
    expect(recorded[0]).toMatchObject({
      resolutionStatus: "strong_identifier",
      identityKind: "cusip",
      evidenceSha256,
    });
    expect(recorded[2]).toEqual({
      importRowId: "row_synthetic_ticker_only_brokerage",
      resolutionStatus: "no_strong_identifier",
      evidenceSha256,
    });
    const providerRecorded = source.recordRetainedProviderExposureEvidence.mock
      .calls[0]![1] as readonly RetainedProviderExposureEvidenceInput[];
    expect(providerRecorded).toHaveLength(5);
    const scopedProviderEvidence = providerRecorded.filter(
      (row) => row.resolutionStatus === "scoped_identifier",
    );
    expect(scopedProviderEvidence).toHaveLength(2);
    expect(
      new Set(scopedProviderEvidence.map((row) => row.protectedIdentityKey))
        .size,
    ).toBe(1);
    expect(providerRecorded[2]).toEqual({
      importRowId: "row_synthetic_cash_brokerage",
      resolutionStatus: "not_eligible",
      evidenceSha256,
    });
    const structuredRecorded = source
      .recordRetainedStructuredAssetExposureEvidence.mock
      .calls[0]![1] as readonly RetainedStructuredAssetExposureEvidenceInput[];
    expect(structuredRecorded).toHaveLength(3);
    const cashEvidence = structuredRecorded.filter(
      (row) =>
        row.resolutionStatus === "structured_identifier" &&
        row.identityKind === "cash_currency",
    );
    expect(cashEvidence).toHaveLength(2);
    expect(
      new Set(cashEvidence.map((row) => row.protectedIdentityKey)).size,
    ).toBe(1);
    expect(cashEvidence.map((row) => row.currencyCode)).toEqual(["USD", "USD"]);
    expect(structuredRecorded[2]).toMatchObject({
      importRowId: "row_synthetic_crypto",
      resolutionStatus: "structured_identifier",
      identityKind: "provider_crypto",
      currencyCode: null,
      evidenceSha256,
    });
    expect(source.reconcileAcceptedPublicExposureHistory).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );

    await new D1RetainedPublicExposureReconciler(env, source).reconcile(
      "synthetic-access-subject",
      "import_synthetic_retained",
    );
    expect(source.listRetainedPublicExposureDocuments).toHaveBeenLastCalledWith(
      "synthetic-access-subject",
      "import_synthetic_retained",
    );
    expect(
      source.reconcileAcceptedPublicExposureHistory,
    ).toHaveBeenLastCalledWith(
      "synthetic-access-subject",
      "import_synthetic_retained",
    );
    const evidenceWrites =
      source.recordRetainedPublicExposureEvidence.mock.calls.length;
    vi.spyOn(env.DOCUMENTS, "get").mockResolvedValueOnce(null);
    await expect(
      new D1RetainedPublicExposureReconciler(env, source).reconcile(
        "synthetic-access-subject",
        "import_synthetic_retained",
      ),
    ).rejects.toThrow(/unavailable/u);
    expect(source.recordRetainedPublicExposureEvidence.mock.calls).toHaveLength(
      evidenceWrites,
    );
    expect(
      source.recordRetainedPublicExposureDocumentFailures,
    ).not.toHaveBeenCalled();
    source.listRetainedPublicExposureDocuments.mockResolvedValueOnce([]);
    await new D1RetainedPublicExposureReconciler(env, source).reconcile(
      "synthetic-access-subject",
      "import_synthetic_retained",
    );
    expect(
      source.reconcileAcceptedPublicExposureHistory,
    ).toHaveBeenLastCalledWith(
      "synthetic-access-subject",
      "import_synthetic_retained",
    );
    await expect(
      new D1RetainedPublicExposureReconciler(env, source).reconcile(
        "synthetic-access-subject",
        "synthetic-other-import",
      ),
    ).rejects.toThrow(/scope/u);
  });

  it("caps a 120-document backlog at five object reads and one write batch per evidence kind", async () => {
    const bytes = sourceResponse();
    const evidenceSha256 = createHash("sha256").update(bytes).digest("hex");
    const source = repository();
    source.listRetainedPublicExposureDocuments.mockResolvedValue(
      Array.from({ length: 120 }, (_, index) => ({
        importId: `synthetic-import-${index}`,
        objectKey: `synthetic/${index}.json`,
        byteSize: bytes.byteLength,
        evidenceSha256,
        rows: [{ importRowId: `synthetic-row-${index}`, sourceRowNumber: 1 }],
      })),
    );
    const get = vi.fn().mockResolvedValue({
      size: bytes.byteLength,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    });
    const env = {
      CONNECTOR_CREDENTIAL_KEY: credentialKey,
      DOCUMENTS: { get },
    } as unknown as Env;
    const result = await new D1RetainedPublicExposureReconciler(
      env,
      source,
    ).reconcile("synthetic-access-subject");
    expect(result).toEqual({
      documentCount: 5,
      skippedDocumentCount: 0,
      identityCount: 5,
    });
    expect(get).toHaveBeenCalledTimes(5);
    expect(source.recordRetainedPublicExposureEvidence).toHaveBeenCalledTimes(
      1,
    );
    expect(
      source.recordRetainedPublicExposureEvidence.mock.calls[0]![1],
    ).toHaveLength(5);
    expect(source.reconcileAcceptedPublicExposureHistory).toHaveBeenCalledTimes(
      1,
    );
  });

  it("fails closed per source document without blocking prior evidence reconciliation", async () => {
    const bytes = sourceResponse();
    const source = repository();
    source.listRetainedPublicExposureDocuments.mockResolvedValue([
      {
        importId: "import_synthetic_retained",
        objectKey: "holding-imports/synthetic-retained.json",
        byteSize: bytes.byteLength,
        evidenceSha256: "0".repeat(64),
        rows: [{ importRowId: "row_synthetic_brokerage", sourceRowNumber: 1 }],
      },
    ]);
    const env = {
      CONNECTOR_CREDENTIAL_KEY: credentialKey,
      DOCUMENTS: {
        get: vi.fn().mockResolvedValue({
          size: bytes.byteLength,
          arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
        }),
      },
    } as unknown as Env;

    await expect(
      new D1RetainedPublicExposureReconciler(env, source).reconcile(
        "synthetic-access-subject",
      ),
    ).resolves.toEqual({
      documentCount: 1,
      skippedDocumentCount: 1,
      identityCount: 0,
    });
    expect(source.recordRetainedPublicExposureEvidence).not.toHaveBeenCalled();
    expect(
      source.recordRetainedPublicExposureDocumentFailures,
    ).toHaveBeenCalledWith("synthetic-access-subject", [
      "import_synthetic_retained",
    ]);
    expect(
      source.recordRetainedProviderExposureEvidence,
    ).not.toHaveBeenCalled();
    expect(
      source.recordRetainedStructuredAssetExposureEvidence,
    ).not.toHaveBeenCalled();
    expect(source.reconcileAcceptedPublicExposureHistory).toHaveBeenCalledTimes(
      1,
    );
  });
});
