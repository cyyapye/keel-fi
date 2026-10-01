import {
  AcceptPositionLinkSchema,
  PositionLinkReceiptSchema,
  PositionLinkWorkspaceSchema,
  type AcceptPositionLink,
  type PositionLinkReceipt,
} from "@keel/domain/position-links";
import { includesCurrentInvestment } from "@keel/domain/investment-review";
import { D1InvestmentPositionViewRepository } from "./position-read-model";

export class PositionLinkError extends Error {}
export class D1PositionLinkRepository {
  constructor(private readonly db: D1Database) {}
  private async identity(subject: string) {
    const row = await this.db
      .prepare(
        `SELECT h.id household_id,u.id user_id FROM users u JOIN households h ON h.owner_user_id=u.id WHERE u.access_subject=? ORDER BY h.created_at LIMIT 1`,
      )
      .bind(subject)
      .first<{ household_id: string; user_id: string }>();
    if (!row)
      throw new PositionLinkError("Investment records are unavailable.");
    return row;
  }
  async workspace(subject: string) {
    const identity = await this.identity(subject);
    const [view, links] = await Promise.all([
      new D1InvestmentPositionViewRepository(this.db).listForHousehold(
        identity.household_id,
        new Date().toISOString(),
        true,
      ),
      this.db
        .prepare(
          `SELECT r.id,r.source_position_id sourcePositionId,r.target_position_id targetPositionId,r.relationship,r.state,r.use_source_value useSourceValue,r.note,r.accepted_at acceptedAt
        FROM holding_position_link_heads h JOIN holding_position_link_reviews r ON r.id=h.review_id WHERE h.household_id=? ORDER BY r.accepted_at,r.id`,
        )
        .bind(identity.household_id)
        .all<
          Omit<PositionLinkReceipt, "useSourceValue"> & {
            useSourceValue: number;
          }
        >(),
    ]);
    return PositionLinkWorkspaceSchema.parse({
      positions: view.connections
        .filter((c) =>
          ["tokenfolio", "sydecar", "angellist"].includes(c.institutionKey),
        )
        .flatMap((c) => c.containers.flatMap((c) => c.positions)),
      links: links.results.map((r) => ({
        ...r,
        useSourceValue: r.useSourceValue === 1,
      })),
    });
  }
  async accept(subject: string, rawInput: AcceptPositionLink) {
    const input = AcceptPositionLinkSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const workspace = await this.workspace(subject);
    const source = workspace.positions.find(
      (p) => p.id === input.sourcePositionId,
    );
    const target = workspace.positions.find(
      (p) => p.id === input.targetPositionId,
    );
    if (!source || !target)
      throw new PositionLinkError(
        "Choose two available private investment records.",
      );
    const prior = workspace.links.find((l) => l.sourcePositionId === source.id);
    if (
      input.expectedSourceParticipationReviewId !==
        (source.investmentReview?.id ?? null) ||
      input.expectedTargetParticipationReviewId !==
        (target.investmentReview?.id ?? null)
    )
      throw new PositionLinkError(
        "The investment review changed. Reload and review again.",
      );
    if (
      (prior?.id ?? null) !== input.expectedReviewId ||
      source.snapshot.id !== input.expectedSourceSnapshotId ||
      target.snapshot.id !== input.expectedTargetSnapshotId
    )
      throw new PositionLinkError(
        "The records changed. Reload and review the link again.",
      );
    if (input.state === "linked") {
      if (!includesCurrentInvestment(target) || target.kind !== "spv_interest")
        throw new PositionLinkError("Keep a current SPV as the investment.");
      if (input.useSourceValue && !includesCurrentInvestment(source))
        throw new PositionLinkError(
          "A historical record cannot provide the current value.",
        );
      if (source.snapshot.currency !== target.snapshot.currency)
        throw new PositionLinkError("These records use different currencies.");
      if (
        workspace.links.some(
          (l) =>
            l.state === "linked" &&
            (l.sourcePositionId === target.id ||
              l.targetPositionId === source.id),
        )
      )
        throw new PositionLinkError(
          "Unlink the existing group before changing its current investment.",
        );
      if (
        input.useSourceValue &&
        workspace.links.some(
          (l) =>
            l.state === "linked" &&
            l.targetPositionId === target.id &&
            l.sourcePositionId !== source.id &&
            l.useSourceValue,
        )
      )
        throw new PositionLinkError(
          "Another linked source already supplies the value. Change that link first.",
        );
    } else if (
      !prior ||
      prior.state !== "linked" ||
      prior.targetPositionId !== target.id
    )
      throw new PositionLinkError("This link is no longer active.");
    const receipt = PositionLinkReceiptSchema.parse({
      id: crypto.randomUUID(),
      ...input,
      acceptedAt: new Date().toISOString(),
    });
    try {
      await this.db
        .prepare(
          `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          receipt.id,
          identity.household_id,
          source.id,
          target.id,
          source.snapshot.id,
          target.snapshot.id,
          input.expectedSourceParticipationReviewId,
          input.expectedTargetParticipationReviewId,
          input.expectedReviewId,
          input.relationship,
          input.state,
          input.useSourceValue ? 1 : 0,
          input.note,
          identity.user_id,
          receipt.acceptedAt,
        )
        .run();
    } catch (error) {
      if (error instanceof Error && /position link|UNIQUE/u.test(error.message))
        throw new PositionLinkError(
          "The link changed or conflicts with another link. Reload and review again.",
        );
      throw error;
    }
    return receipt;
  }
}
