import {
  sourceInvestmentAmount,
  InvestmentReviewStateSchema,
} from "@keel/domain/investment-review";
import {
  AcceptPositionEconomicsInputSchema,
  PositionEconomicsTermsSchema,
  calculatePositionEconomics,
  type AcceptPositionEconomicsInput,
  type PositionEconomicsTerms,
} from "@keel/domain/position-economics";

type PositionEconomicsIdentityRow = {
  household_id: string;
  user_id: string;
};

type CurrentPositionEconomicsRow = {
  position_id: string;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  snapshot_id: string;
  invested_minor: number;
  allocation_minor: number;
  provider: string;
  state_json: string | null;
  currency: string;
};

type AcceptedPositionEconomicsRow = {
  id: string;
};

export type PositionEconomicsErrorCode =
  "not_found" | "not_spv" | "missing_commitment" | "capital_mismatch" | "stale";

export class PositionEconomicsError extends Error {
  public constructor(
    public readonly code: PositionEconomicsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PositionEconomicsError";
  }
}

export interface PositionEconomicsRepository {
  accept(
    accessSubject: string,
    positionId: string,
    input: AcceptPositionEconomicsInput,
  ): Promise<PositionEconomicsTerms>;
}

export class D1PositionEconomicsRepository implements PositionEconomicsRepository {
  public constructor(private readonly db: D1Database) {}

  public async accept(
    accessSubject: string,
    positionId: string,
    rawInput: AcceptPositionEconomicsInput,
  ): Promise<PositionEconomicsTerms> {
    const input = AcceptPositionEconomicsInputSchema.parse(rawInput);
    const identity = await this.findIdentity(accessSubject);
    const position = await this.currentPosition(
      identity.household_id,
      positionId,
    );
    if (position === null) {
      throw new PositionEconomicsError(
        "not_found",
        "Position was not found for economics review.",
      );
    }
    if (position.position_kind !== "spv_interest") {
      throw new PositionEconomicsError(
        "not_spv",
        "Fee and carry terms are available only for SPV positions.",
      );
    }
    const sourceAmountMinor = sourceInvestmentAmount(
      position.provider,
      position.invested_minor,
      position.allocation_minor,
    );
    const review =
      position.state_json == null
        ? null
        : InvestmentReviewStateSchema.parse(JSON.parse(position.state_json));
    const amountMinor =
      review?.amountCorrection?.amountMinor ?? sourceAmountMinor;
    if (
      (input.expectedCommitmentMinor === undefined &&
        sourceAmountMinor !== position.allocation_minor) ||
      (input.expectedCommitmentMinor ?? sourceAmountMinor) !== amountMinor
    )
      throw new PositionEconomicsError(
        "stale",
        "The investment amount changed. Reload before reviewing fees.",
      );
    if (amountMinor <= 0) {
      throw new PositionEconomicsError(
        "missing_commitment",
        "Fee and carry terms need a reported SPV commitment.",
      );
    }
    if (position.snapshot_id !== input.expectedSnapshotId) {
      throw new PositionEconomicsError(
        "stale",
        "The position changed before its economics were accepted.",
      );
    }

    const currentTerms = await this.currentTerms(
      identity.household_id,
      positionId,
    );
    if ((currentTerms?.id ?? null) !== input.expectedTermsId) {
      throw new PositionEconomicsError(
        "stale",
        "Newer reviewed position economics are already available.",
      );
    }

    const proposalId = crypto.randomUUID();
    const reviewId = crypto.randomUUID();
    const acceptedAt = new Date().toISOString();
    const terms = PositionEconomicsTermsSchema.parse({
      id: proposalId,
      positionId,
      acceptedAgainstSnapshotId: position.snapshot_id,
      commitmentMinorAtAcceptance: amountMinor,
      fundedMinorAtAcceptance: position.invested_minor,
      capitalBasis: input.capitalBasis ?? "gross_commitment",
      grossCommitmentMinor: input.grossCommitmentMinor ?? null,
      setupFeePpm: input.setupFeePpm ?? null,
      annualAdminFeePpm: input.annualAdminFeePpm,
      adminFeeYears: input.adminFeeYears,
      carryPpm: input.carryPpm,
      note: input.note,
      acceptedAt,
      decisionSource: "manual",
    });
    if (
      calculatePositionEconomics({
        snapshotId: position.snapshot_id,
        currency: position.currency,
        committedMinor: amountMinor,
        fundedMinor: position.invested_minor,
        reportedTerms: null,
        acceptedTerms: terms,
      }) === null
    ) {
      throw new PositionEconomicsError(
        "capital_mismatch",
        "Gross commitment less management and setup fees must equal the imported net amount.",
      );
    }
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO holding_position_economics_proposals (
               id, household_id, position_id, snapshot_id,
               supersedes_proposal_id, commitment_minor, funded_minor,
               capital_basis, gross_commitment_minor, setup_fee_ppm,
               annual_admin_fee_ppm, admin_fee_years, carry_ppm, note,
               created_by, created_at, immutable
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            proposalId,
            identity.household_id,
            positionId,
            position.snapshot_id,
            currentTerms?.id ?? null,
            amountMinor,
            position.invested_minor,
            terms.capitalBasis,
            terms.grossCommitmentMinor,
            terms.setupFeePpm,
            input.annualAdminFeePpm,
            input.adminFeeYears,
            input.carryPpm,
            input.note,
            identity.user_id,
            acceptedAt,
          ),
        this.db
          .prepare(
            `INSERT INTO holding_position_economics_reviews (
               id, household_id, proposal_id, reviewer_user_id, decision,
               rationale, decided_at, immutable
             ) VALUES (?, ?, ?, ?, 'accepted', ?, ?, 1)`,
          )
          .bind(
            reviewId,
            identity.household_id,
            proposalId,
            identity.user_id,
            `Accepted reviewed SPV fee and carry terms: ${input.note}`.slice(
              0,
              1_000,
            ),
            acceptedAt,
          ),
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE|position economics proposal (?:provenance mismatch|snapshot is stale)/u.test(
          error.message,
        )
      ) {
        throw new PositionEconomicsError(
          "stale",
          "Newer reviewed position economics are already available.",
        );
      }
      throw error;
    }

    return terms;
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<PositionEconomicsIdentityRow> {
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
      .first<PositionEconomicsIdentityRow>();
    if (identity === null) {
      throw new PositionEconomicsError(
        "not_found",
        "Household was not found for the authenticated user.",
      );
    }
    return identity;
  }

  private currentPosition(
    householdId: string,
    positionId: string,
  ): Promise<CurrentPositionEconomicsRow | null> {
    return this.db
      .prepare(
        `SELECT
           position.id AS position_id,
           position.position_kind,
           position.provider,
           review.state_json,
           position.currency,
           snapshot.id AS snapshot_id,
           snapshot.invested_minor,
           snapshot.allocation_minor
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
         LEFT JOIN holding_investment_reviews review ON review.id = (
           SELECT id FROM holding_investment_reviews WHERE household_id = position.household_id AND position_id = position.id ORDER BY version DESC LIMIT 1
         )
         WHERE position.id = ?
           AND position.household_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_continuities continuity
             WHERE continuity.predecessor_position_id = position.id
           )`,
      )
      .bind(positionId, householdId)
      .first<CurrentPositionEconomicsRow>();
  }

  private currentTerms(
    householdId: string,
    positionId: string,
  ): Promise<AcceptedPositionEconomicsRow | null> {
    return this.db
      .prepare(
        `SELECT proposal.id
         FROM holding_position_economics_proposals proposal
         JOIN holding_position_economics_reviews review
           ON review.proposal_id = proposal.id
          AND review.decision = 'accepted'
         WHERE proposal.household_id = ?
           AND proposal.position_id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM holding_position_economics_proposals later
             JOIN holding_position_economics_reviews later_review
               ON later_review.proposal_id = later.id
              AND later_review.decision = 'accepted'
             WHERE later.supersedes_proposal_id = proposal.id
           )
         ORDER BY review.decided_at DESC, proposal.id DESC
         LIMIT 1`,
      )
      .bind(householdId, positionId)
      .first<AcceptedPositionEconomicsRow>();
  }
}
