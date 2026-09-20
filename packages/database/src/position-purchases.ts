import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
  type AcceptPurchases,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";

export class PositionPurchaseError extends Error {
  constructor(
    public readonly code: "not_found" | "stale" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "PositionPurchaseError";
  }
}
export interface PositionPurchaseRepository {
  accept(
    subject: string,
    positionId: string,
    input: AcceptPurchases,
  ): Promise<PurchaseReceipt>;
}
export class D1PositionPurchaseRepository implements PositionPurchaseRepository {
  constructor(private readonly db: D1Database) {}
  async accept(
    subject: string,
    positionId: string,
    raw: AcceptPurchases,
  ): Promise<PurchaseReceipt> {
    const input = AcceptPurchasesSchema.parse(raw);
    const position = await this.db
      .prepare(
        `SELECT p.household_id,p.position_kind,p.currency,u.id user_id
      FROM users u JOIN households h ON h.owner_user_id=u.id JOIN holding_positions p ON p.household_id=h.id
      WHERE u.access_subject=? AND p.id=?`,
      )
      .bind(subject, positionId)
      .first<{
        household_id: string;
        position_kind: string;
        currency: string;
        user_id: string;
      }>();
    if (!position)
      throw new PositionPurchaseError("not_found", "Position was not found.");
    if (
      position.position_kind !== "spv_interest" ||
      position.currency !== "USD"
    )
      throw new PositionPurchaseError(
        "unsupported",
        "Purchase details currently support USD SPV positions.",
      );
    const receipt = PurchaseReceiptSchema.parse({
      id: crypto.randomUUID(),
      positionId,
      snapshotId: input.expectedSnapshotId,
      currency: position.currency,
      details: input.details,
      acceptedAt: new Date().toISOString(),
    });
    try {
      await this.db
        .prepare(
          `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          receipt.id,
          position.household_id,
          positionId,
          receipt.snapshotId,
          input.expectedReceiptId,
          JSON.stringify(receipt),
          position.user_id,
          receipt.acceptedAt,
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        /purchase (?:review stale|snapshot stale|provenance mismatch)/u.test(
          error.message,
        )
      )
        throw new PositionPurchaseError(
          "stale",
          "The position or purchase details changed. Reload and review again.",
        );
      throw error;
    }
    return receipt;
  }
}
