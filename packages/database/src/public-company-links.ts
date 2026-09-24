import {
  PublicCompanyLinkCatalogSchema,
  PublicCompanyLinkReceiptSchema,
  PublicCompanyLinkReviewSchema,
  type PublicCompanyLinkReview,
} from "@keel/domain/public-company-links";

type Identity = { household_id: string; user_id: string };
type SecurityRow = {
  exposure_id: string;
  name: string;
  company_id: string | null;
  review_id: string | null;
  position_count: number;
};
type CompanyRow = { id: string; name: string };

export class PublicCompanyLinkError extends Error {
  constructor(
    public readonly code: "not_found" | "stale" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export class D1PublicCompanyLinkRepository {
  constructor(private readonly db: D1Database) {}

  private async identity(subject: string): Promise<Identity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM users user JOIN households household
           ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at LIMIT 1`,
      )
      .bind(subject)
      .first<Identity>();
    if (identity === null)
      throw new PublicCompanyLinkError("not_found", "Household not found.");
    return identity;
  }

  private async catalogFor(householdId: string) {
    const [securities, companies] = await Promise.all([
      this.db
        .prepare(
          `SELECT exposure.id AS exposure_id, exposure.canonical_name AS name,
                  COALESCE(redirect.company_id, link.company_id) AS company_id,
                  link.review_id,
                  COUNT(DISTINCT mapping.position_id) AS position_count
           FROM canonical_exposures exposure
           JOIN holding_position_exposure_mappings mapping
             ON mapping.exposure_id = exposure.id
            AND mapping.household_id = exposure.household_id
            AND mapping.status = 'active'
           LEFT JOIN public_exposure_company_links link
             ON link.public_exposure_id = exposure.id
           LEFT JOIN company_redirects redirect
             ON redirect.source_company_id = link.company_id
           WHERE exposure.household_id = ?
             AND exposure.exposure_kind = 'public_instrument'
             AND NOT EXISTS (
               SELECT 1 FROM holding_position_continuities continuity
               WHERE continuity.predecessor_position_id = mapping.position_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM holding_position_exposure_mappings later
               WHERE later.supersedes_mapping_id = mapping.id
             )
           GROUP BY exposure.id
           ORDER BY lower(exposure.canonical_name), exposure.id
           LIMIT 5001`,
        )
        .bind(householdId)
        .all<SecurityRow>(),
      this.db
        .prepare(
          `SELECT company.id, company.legal_name AS name
           FROM companies company
           JOIN canonical_exposures exposure
             ON exposure.company_id = company.id
            AND exposure.household_id = company.household_id
            AND exposure.exposure_kind = 'private_company'
           WHERE company.household_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM company_redirects redirect
               WHERE redirect.source_company_id = company.id
             )
             AND EXISTS (
               SELECT 1 FROM holding_position_exposure_mappings mapping
               WHERE mapping.exposure_id = exposure.id
                 AND mapping.household_id = exposure.household_id
                 AND mapping.status = 'active'
                 AND NOT EXISTS (
                   SELECT 1 FROM holding_position_exposure_mappings later
                   WHERE later.supersedes_mapping_id = mapping.id
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM holding_position_continuities continuity
                   WHERE continuity.predecessor_position_id = mapping.position_id
                 )
             )
           ORDER BY lower(company.legal_name), company.id
           LIMIT 5001`,
        )
        .bind(householdId)
        .all<CompanyRow>(),
    ]);
    if (securities.results.length > 5000 || companies.results.length > 5000)
      throw new PublicCompanyLinkError(
        "invalid",
        "The public company review list is too large.",
      );
    return PublicCompanyLinkCatalogSchema.parse({
      securities: securities.results.map((row) => ({
        exposureId: row.exposure_id,
        name: row.name,
        companyId: row.company_id,
        reviewId: row.review_id,
        positionCount: row.position_count,
      })),
      companies: companies.results,
    });
  }

  async getCatalog(subject: string) {
    const identity = await this.identity(subject);
    return this.catalogFor(identity.household_id);
  }

  async review(subject: string, rawInput: PublicCompanyLinkReview) {
    const input = PublicCompanyLinkReviewSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const catalog = await this.catalogFor(identity.household_id);
    const security = catalog.securities.find(
      (item) => item.exposureId === input.exposureId,
    );
    if (
      security === undefined ||
      !catalog.companies.some((item) => item.id === input.companyId)
    )
      throw new PublicCompanyLinkError(
        "invalid",
        "Choose a public security and an existing company exposure.",
      );
    if (security.reviewId !== input.expectedReviewId)
      throw new PublicCompanyLinkError(
        "stale",
        "This security link changed. Review it again.",
      );
    const id = crypto.randomUUID();
    const reviewedAt = new Date().toISOString();
    try {
      await this.db
        .prepare(
          `INSERT INTO public_exposure_company_reviews (
             id, household_id, public_exposure_id, company_id, source_url,
             reason, expected_review_id, reviewer_user_id, reviewed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          identity.household_id,
          input.exposureId,
          input.companyId,
          input.sourceUrl,
          input.reason,
          input.expectedReviewId,
          identity.user_id,
          reviewedAt,
        )
        .run();
    } catch (error) {
      if (String(error).includes("stale"))
        throw new PublicCompanyLinkError(
          "stale",
          "This security link changed. Review it again.",
        );
      throw error;
    }
    return PublicCompanyLinkReceiptSchema.parse({
      id,
      exposureId: input.exposureId,
      companyId: input.companyId,
      reviewedAt,
    });
  }
}
