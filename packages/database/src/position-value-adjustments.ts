import {
  AcceptPositionValueAdjustmentInputSchema,
  PositionValueAdjustmentSchema,
  type AcceptPositionValueAdjustmentInput,
  type PositionValueAdjustment,
} from "@keel/domain/position-value";

type PositionValueIdentityRow = {
  household_id: string;
  user_id: string;
};

type CurrentPositionValueRow = {
  position_id: string;
  snapshot_id: string;
  currency: string;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  unrealized_value_minor: number | null;
};

type AcceptedAdjustmentRow = {
  id: string;
  value_minor: number;
};

export type PositionValueAdjustmentErrorCode =
  "not_found" | "stale" | "currency_mismatch" | "invalid_effective_date";

export class PositionValueAdjustmentError extends Error {
  public constructor(
    public readonly code: PositionValueAdjustmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PositionValueAdjustmentError";
  }
}

export interface PositionValueAdjustmentRepository {
  accept(
    accessSubject: string,
    positionId: string,
    input: AcceptPositionValueAdjustmentInput,
  ): Promise<PositionValueAdjustment>;
}

export class D1PositionValueAdjustmentRepository implements PositionValueAdjustmentRepository {
  public constructor(private readonly db: D1Database) {}

  public async accept(
    accessSubject: string,
    positionId: string,
    rawInput: AcceptPositionValueAdjustmentInput,
  ): Promise<PositionValueAdjustment> {
    const input = AcceptPositionValueAdjustmentInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const position = await this.currentPosition(
      identity.household_id,
      positionId,
    );
    if (position === null) {
      throw new PositionValueAdjustmentError(
        "not_found",
        "Position was not found for value review.",
      );
    }
    if (position.snapshot_id !== input.expectedSnapshotId) {
      throw new PositionValueAdjustmentError(
        "stale",
        "The position changed before the value was accepted.",
      );
    }
    if (position.currency !== input.currency) {
      throw new PositionValueAdjustmentError(
        "currency_mismatch",
        "The reviewed value currency does not match the position.",
      );
    }
    const today = new Date().toISOString().slice(0, "YYYY-MM-DD".length);
    if (input.effectiveDate > today) {
      throw new PositionValueAdjustmentError(
        "invalid_effective_date",
        "Position value evidence cannot be dated in the future.",
      );
    }

    const currentAdjustment = await this.currentAdjustment(
      identity.household_id,
      positionId,
    );
    if ((currentAdjustment?.id ?? null) !== input.expectedAdjustmentId) {
      throw new PositionValueAdjustmentError(
        "stale",
        "A newer reviewed position value is already available.",
      );
    }

    const priorValueState =
      currentAdjustment === null ? position.unrealized_value_state : "reported";
    const priorValueMinor =
      currentAdjustment?.value_minor ?? position.unrealized_value_minor;
    const proposalId = crypto.randomUUID();
    const reviewId = crypto.randomUUID();
    const acceptedAt = new Date().toISOString();

    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO holding_position_value_proposals (
               id, household_id, position_id, snapshot_id,
               supersedes_proposal_id, prior_value_state, prior_value_minor,
               value_minor, currency, effective_date, source_kind,
               source_label, source_url, commentary, created_by, created_at,
               immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            proposalId,
            identity.household_id,
            positionId,
            position.snapshot_id,
            currentAdjustment?.id ?? null,
            priorValueState,
            priorValueMinor,
            input.valueMinor,
            input.currency,
            input.effectiveDate,
            input.sourceKind,
            input.sourceLabel,
            input.sourceUrl,
            input.commentary,
            identity.user_id,
            acceptedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO holding_position_value_reviews (
               id, household_id, proposal_id, reviewer_user_id, decision,
               rationale, decided_at, immutable
             ) VALUES (?, ?, ?, ?, 'accepted', ?, ?, 1)`,
          )
          .bind(
            reviewId,
            identity.household_id,
            proposalId,
            identity.user_id,
            `Accepted ${input.sourceLabel} as position value evidence.`.slice(
              0,
              1_000,
            ),
            acceptedAt,
          ),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new PositionValueAdjustmentError(
          "stale",
          "A newer reviewed position value is already available.",
        );
      }
      throw error;
    }

    return PositionValueAdjustmentSchema.parse({
      id: proposalId,
      positionId,
      snapshotId: position.snapshot_id,
      priorValueState,
      priorValueMinor,
      valueMinor: input.valueMinor,
      currency: input.currency,
      effectiveDate: input.effectiveDate,
      sourceKind: input.sourceKind,
      sourceLabel: input.sourceLabel,
      sourceUrl: input.sourceUrl,
      commentary: input.commentary,
      acceptedAt,
    });
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<PositionValueIdentityRow> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<PositionValueIdentityRow>();
    if (identity === null) {
      throw new PositionValueAdjustmentError(
        "not_found",
        "Household was not found for the authenticated user.",
      );
    }
    return identity;
  }

  private currentPosition(
    householdId: string,
    positionId: string,
  ): Promise<CurrentPositionValueRow | null> {
    return this.db
      .prepare(
        `SELECT
           position.id AS position_id,
           snapshot.id AS snapshot_id,
           snapshot.currency,
           snapshot.unrealized_value_state,
           snapshot.unrealized_value_minor
         FROM holding_positions position
         JOIN holding_import_applications application
           ON application.id = (
             SELECT candidate.id
             FROM holding_import_applications candidate
             JOIN holding_position_snapshots candidate_snapshot
               ON candidate_snapshot.id = candidate.snapshot_id
             WHERE candidate.position_id = position.id
             ORDER BY candidate.applied_at DESC,
                      candidate_snapshot.observed_at DESC,
                      candidate.id DESC
             LIMIT 1
           )
         JOIN holding_position_snapshots snapshot
           ON snapshot.id = application.snapshot_id
         WHERE position.id = ?
           AND position.household_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_continuities continuity
             WHERE continuity.predecessor_position_id = position.id
           )`,
      )
      .bind(positionId, householdId)
      .first<CurrentPositionValueRow>();
  }

  private currentAdjustment(
    householdId: string,
    positionId: string,
  ): Promise<AcceptedAdjustmentRow | null> {
    return this.db
      .prepare(
        `SELECT proposal.id, proposal.value_minor
         FROM holding_position_value_proposals proposal
         JOIN holding_position_value_reviews review
           ON review.proposal_id = proposal.id
          AND review.decision = 'accepted'
         WHERE proposal.household_id = ?
           AND proposal.position_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_value_proposals later
             JOIN holding_position_value_reviews later_review
               ON later_review.proposal_id = later.id
              AND later_review.decision = 'accepted'
             WHERE later.supersedes_proposal_id = proposal.id
           )
         ORDER BY review.decided_at DESC, proposal.id DESC
         LIMIT 1`,
      )
      .bind(householdId, positionId)
      .first<AcceptedAdjustmentRow>();
  }
}
