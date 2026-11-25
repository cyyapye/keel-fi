// Delivery notices and brokerage statements are independent observations in this local example.
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { D1HoldingsPageRepository } from "../packages/database/src/holdings-page";
import { D1HoldingImportRepository } from "../packages/database/src/holding-imports";
import { D1InvestmentConnectionsRepository } from "../packages/database/src/investment-connections";
import { recordOfficialClose } from "../packages/database/src/market-close";
import { firstCedarClose, nextCedarClose } from "./seed-closing-price";
import { LINK_DEMO_SUBJECT as subject } from "./seed-position-links";

const batch = process.argv[2];
if (batch !== "first" && batch !== "second")
  throw new Error("Select a synthetic delivery.");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const date = batch === "first" ? "2026-10-09" : "2026-11-23";
const root = resolve(".keel-local/scenarios/pre-distribution");
const proxy = await getPlatformProxy<{ DB: D1Database; DOCUMENTS: R2Bucket }>({
  configPath: resolve("apps/api/wrangler.jsonc"),
  environment: "local",
  remoteBindings: false,
  envFiles: [],
  persist: { path: join(root, "v3") },
});
try {
  const db = proxy.env.DB;
  const page = await new D1HoldingsPageRepository(db).getPage(
    subject,
    "available",
  );
  const item = page.holdings.find(
    (h) =>
      h.purchaseContext?.receipt?.publicClose?.ticker === "CDR" &&
      h.purchaseContext.receipt.details.lots[0]?.quantityDetails?.shareBasis
        .key === firstCedarClose.shareBasis.key,
  );
  const receipt = item?.purchaseContext?.receipt;
  const quote = receipt?.publicClose;
  if (!receipt || !quote)
    throw new Error("Approve the price proxy in Holdings first.");
  const history = receipt.details.distributionReview;
  const id = "demo-delivery-" + batch;
  const events = history?.events ?? [];
  if (batch === "second" && !events.some((e) => e.id === "demo-delivery-first"))
    throw new Error("Load the first delivery before the second.");
  if (batch === "first" && events.some((e) => e.id === "demo-delivery-second"))
    throw new Error("Both deliveries are already recorded.");
  const shares = batch === "first" ? 25 : 15;
  const quantityMicros = shares * 1_000_000;
  const released = {
    kind: "in_kind" as const,
    id,
    receivedOn: date,
    securityLabel: "CDR",
    quantityMicros,
    spvDebit: {
      ticker: "CDR",
      shareBasis: firstCedarClose.shareBasis,
      quantityMicros,
    },
    investorValueMinor: Number(BigInt(shares) * 5200n),
    sourceLabel: "Synthetic Grove distribution notice",
    sourceUrl: null,
    note: "",
  };
  await recordOfficialClose(db, {
    ...nextCedarClose,
    exposureId: quote.exposureId,
    date,
    observedAt: date + "T21:15:00.000Z",
    sourceUrl: "https://exchange.example/cedar/" + date,
  });
  if (!events.some((e) => e.id === id))
    await new D1PositionPurchaseRepository(db).acceptDistributions(
      subject,
      receipt.positionId,
      {
        expectedReceiptId: receipt.id,
        expectedSnapshotId: receipt.snapshotId,
        distributionReview: {
          method: "capital_return_first_v1",
          events: [...events, released],
          coverage: { status: "complete", throughDate: date },
          priorCarry: { status: "known", amountMinor: 0 },
          provider: {
            inclusion: "none",
            sourceSnapshotId: receipt.snapshotId,
            realizedValueMinor: 0,
          },
          sourceLabel: "Synthetic Grove notices",
          sourceUrl: null,
          note: "",
        },
      },
    );
  // The account inventory confirms cumulative shares. Replaying a notice must never add to that inventory.
  const brokerShares = batch === "first" ? 25 : 40;
  const connection = await new D1InvestmentConnectionsRepository(
    db,
  ).upsertConnection(
    subject,
    "synthetic-demo-reference",
    hash("demo-CDR-brokerage"),
    "demo-broker",
    "Demo brokerage",
  );
  const account = hash("demo-CDR-account"),
    security = hash("demo-CDR-security");
  const raw = JSON.stringify({
    date,
    ticker: "CDR",
    shares: brokerShares,
    price: "52.00",
  });
  const objectKey = "synthetic/pre-distribution/brokerage-" + date + ".json";
  await proxy.env.DOCUMENTS.put(objectKey, raw);
  const imports = new D1HoldingImportRepository(db);
  const staged = await imports.stagePlaidInvestmentsHoldingImport(subject, {
    objectKey,
    sha256: hash(raw),
    byteSize: Buffer.byteLength(raw),
    normalizedFingerprint: hash(raw),
    effectiveDate: date,
    retrievedAt: date + "T21:30:00.000Z",
    rows: [
      {
        rowNumber: 1,
        naturalKeySha256: security,
        securityName: "Cedar Robotics",
        ticker: "CDR",
        securityType: "equity",
        accountLabel: "Demo brokerage",
        quantityMicros: brokerShares * 1_000_000,
        costBasisMinor: null,
        marketValueMinor: Number(BigInt(brokerShares) * 5200n),
        observedOn: date,
        currency: "USD",
        issues: [],
      },
    ],
    canonicalScope: {
      connection: { mode: "existing", connectionId: connection.id },
      containers: [
        {
          protectedAccountKey: account,
          displayLabel: "Demo brokerage",
          containerKind: "brokerage",
          taxTreatment: "taxable",
          completeness: "complete",
        },
      ],
      rows: [
        {
          sourceRowNumber: 1,
          protectedAccountKey: account,
          protectedPositionKey: security,
          publicExposureIdentityKind: "cusip",
          protectedExposureKey: security,
        },
      ],
    },
  });
  if (staged.preview.status !== "applied")
    await imports.applyHoldingImport(subject, staged.preview.id, {
      currency: "USD",
      decisions: staged.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Reviewed synthetic brokerage statement.",
      })),
    });
  console.log(quote.exposureId);
} finally {
  await proxy.dispose();
}
