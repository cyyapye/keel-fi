import { canonicalizeCompanyWebsite } from "@keel/connectors";
import { z } from "zod";
import {
  WatchWebsiteInputSchema,
  WatchWebsiteReceiptSchema,
} from "@keel/domain/watch-website";

export class D1WatchWebsiteRepository {
  public constructor(private readonly db: D1Database) {}

  public async target(subject: string, targetId: string) {
    z.string().min(1).max(500).parse(targetId);
    const target = await this.db
      .prepare(
        `SELECT target.id, company.id AS companyId, company.legal_name AS companyName, company.website_host AS officialHost, household.id AS householdId, user.id AS userId
      FROM portfolio_watch_targets target JOIN companies company ON company.id = target.company_id AND company.household_id = target.household_id
      JOIN households household ON household.id = target.household_id JOIN users user ON user.id = household.owner_user_id
      WHERE target.id = ? AND user.access_subject = ? AND target.status = 'active'`,
      )
      .bind(targetId, subject)
      .first<{
        id: string;
        companyId: string;
        companyName: string;
        officialHost: string | null;
        householdId: string;
        userId: string;
      }>();
    if (target === null) throw new Error("watch_target_not_found");
    return target;
  }

  public async confirm(
    subject: string,
    targetId: string,
    rawInput: unknown,
    now = new Date().toISOString(),
  ) {
    const input = WatchWebsiteInputSchema.parse(rawInput);
    z.iso.datetime({ offset: true }).parse(now);
    const target = await this.target(subject, targetId);
    const website = canonicalizeCompanyWebsite({
      companyId: target.companyId,
      homepageUrl: input.websiteUrl,
    });
    const existing = await this.db
      .prepare(
        `SELECT id AS decisionId, website_host AS officialHost, decided_at AS decidedAt, company_name, reviewed_url, rationale
      FROM portfolio_watch_website_decisions WHERE id = ? AND household_id = ? AND company_id = ? AND reviewer_user_id = ?`,
      )
      .bind(
        input.decisionId,
        target.householdId,
        target.companyId,
        target.userId,
      )
      .first<{
        decisionId: string;
        officialHost: string;
        decidedAt: string;
        company_name: string;
        reviewed_url: string;
        rationale: string;
      }>();
    if (existing !== null) {
      if (
        existing.company_name !== input.companyName ||
        existing.reviewed_url !== website.homepageUrl ||
        existing.rationale !== input.rationale
      )
        throw new Error("watch_website_changed");
      return WatchWebsiteReceiptSchema.parse(existing);
    }
    if (
      target.officialHost !== null ||
      target.companyName !== input.companyName
    )
      throw new Error("watch_website_changed");
    // The trigger revalidates identity and applies the recorded decision atomically.
    const result = await this.db
      .prepare(
        `INSERT INTO portfolio_watch_website_decisions
      (id, household_id, company_id, reviewer_user_id, company_name, website_host, reviewed_url, rationale, decided_at)
      SELECT ?, ?, company.id, ?, ?, ?, ?, ?, ? FROM companies company
      WHERE company.id = ? AND company.household_id = ? AND company.website_host IS NULL AND company.legal_name = ?
      RETURNING id AS decisionId, website_host AS officialHost, decided_at AS decidedAt`,
      )
      .bind(
        input.decisionId,
        target.householdId,
        target.userId,
        input.companyName,
        website.approvedWebsiteHost,
        website.homepageUrl,
        input.rationale,
        now,
        target.companyId,
        target.householdId,
        input.companyName,
      )
      .first();
    if (result === null) throw new Error("watch_website_changed");
    return WatchWebsiteReceiptSchema.parse(result);
  }
}
