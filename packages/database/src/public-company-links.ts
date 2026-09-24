import {
  PublicCompanyLinkCatalogSchema,
  PublicCompanyMatchSchema,
  IssuerSearchResultsSchema,
  recommendPublicCompany,
  type IssuerSearchResults,
  type MatchCompany,
  PublicCompanyLinkReceiptSchema,
  PublicCompanyLinkReviewSchema,
  type PublicCompanyLinkReview,
} from "@keel/domain/public-company-links";

type Identity = { household_id: string; user_id: string; revision: number };
type SecurityRow = {
  exposure_id: string;
  name: string;
  company_id: string | null;
  review_id: string | null;
  position_count: number;
};
type CompanyRow = {
  id: string;
  name: string;
  website_host: string | null;
  aliases_json: string;
};

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
        `SELECT household.id AS household_id, user.id AS user_id, COALESCE(revision.revision, 0) AS revision
         FROM users user JOIN households household
           ON household.owner_user_id = user.id
         LEFT JOIN company_identity_revisions revision ON revision.household_id = household.id
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
           JOIN holding_position_exposure_heads mapping
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
           GROUP BY exposure.id
           ORDER BY lower(exposure.canonical_name), exposure.id
           LIMIT 5001`,
        )
        .bind(householdId)
        .all<SecurityRow>(),
      this.db
        .prepare(
          `SELECT company.id, company.legal_name AS name, company.website_host,
           (SELECT json_group_array(alias.alias_name) FROM company_aliases alias
            WHERE alias.household_id = company.household_id AND alias.company_id = company.id) AS aliases_json
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
               SELECT 1 FROM holding_position_exposure_heads mapping
               WHERE mapping.exposure_id = exposure.id
                 AND mapping.household_id = exposure.household_id
                 AND mapping.status = 'active'
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
    return {
      catalog: PublicCompanyLinkCatalogSchema.parse({
        securities: securities.results.map((row) => ({
          exposureId: row.exposure_id,
          name: row.name,
          companyId: row.company_id,
          reviewId: row.review_id,
          positionCount: row.position_count,
        })),
        companies: companies.results,
      }),
      companies: companies.results.map((row): MatchCompany => ({
        id: row.id,
        name: row.name,
        aliases: JSON.parse(row.aliases_json) as string[],
        websiteHost: row.website_host,
      })),
    };
  }

  async getCatalog(subject: string) {
    const identity = await this.identity(subject);
    return (await this.catalogFor(identity.household_id)).catalog;
  }

  async recommend(
    subject: string,
    exposureId: string,
    search?: (issuer: string) => Promise<IssuerSearchResults>,
  ) {
    const identity = await this.identity(subject);
    const { catalog, companies } = await this.catalogFor(identity.household_id);
    const security = catalog.securities.find(
      (item) => item.exposureId === exposureId,
    );
    if (security === undefined)
      throw new PublicCompanyLinkError(
        "not_found",
        "This public holding is no longer available.",
      );
    const now = new Date().toISOString();
    const cacheKey = JSON.stringify([
      identity.revision,
      security.name,
      security.reviewId,
      now.slice(0, 10),
    ]);
    const lookup = () =>
      this.db
        .prepare(
          `SELECT id, result_json FROM public_company_match_runs WHERE household_id = ? AND exposure_id = ? AND cache_key = ?`,
        )
        .bind(identity.household_id, exposureId, cacheKey)
        .first<{ id: string; result_json: string | null }>();
    let run = await lookup();
    if (run?.result_json)
      return PublicCompanyMatchSchema.parse(JSON.parse(run.result_json));
    if (run === null) {
      const id = crypto.randomUUID();
      const initialMatch = recommendPublicCompany(security.name, companies);
      const needsSearch =
        initialMatch.status === "no_match" && search !== undefined;
      const admitted = await this.db
        .prepare(
          `INSERT INTO public_company_match_runs (id, household_id, exposure_id, issuer_name, identity_revision, expected_review_id, cache_key, created_at, search_requested) SELECT ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 AND (SELECT count(*) FROM public_company_match_runs WHERE household_id = ? AND created_at >= ? AND search_requested = 1) < 20 THEN 1 ELSE 0 END WHERE 1 ON CONFLICT(household_id, exposure_id, cache_key) DO NOTHING RETURNING id, search_requested`,
        )
        .bind(
          id,
          identity.household_id,
          exposureId,
          security.name,
          identity.revision,
          security.reviewId,
          cacheKey,
          now,
          needsSearch ? 1 : 0,
          identity.household_id,
          `${now.slice(0, 10)}T00:00:00.000Z`,
        )
        .first<{ id: string; search_requested: number }>();
      if (admitted !== null) {
        let evidence: IssuerSearchResults = [];
        let match = initialMatch;
        if (match.status === "no_match") {
          if (search === undefined)
            match = {
              ...match,
              status: "unavailable",
              reason:
                "Issuer lookup is unavailable. Keel could not verify a match from saved company names.",
            };
          else if (admitted.search_requested === 0)
            match = {
              ...match,
              status: "unavailable",
              reason:
                "Today’s issuer lookup limit has been reached. Try tomorrow or choose the company manually.",
            };
          else
            try {
              evidence = IssuerSearchResultsSchema.parse(
                await search(security.name),
              );
              match = recommendPublicCompany(
                security.name,
                companies,
                evidence,
              );
            } catch {
              match = {
                ...match,
                status: "unavailable",
                reason:
                  "The issuer lookup failed. Your holdings have not changed.",
              };
            }
        }
        const result = PublicCompanyMatchSchema.parse({
          ...match,
          id,
          exposureId,
        });
        await this.db
          .prepare(
            `UPDATE public_company_match_runs SET result_json = ?, evidence_json = ? WHERE id = ? AND result_json IS NULL`,
          )
          .bind(
            JSON.stringify(result),
            JSON.stringify({
              securityName: security.name,
              companies: companies.filter(
                (company) => company.id === match.companyId,
              ),
              searchResults: evidence,
            }),
            id,
          )
          .run();
        return result;
      }
      run = await lookup();
      if (run?.result_json)
        return PublicCompanyMatchSchema.parse(JSON.parse(run.result_json));
    }
    if (run === null)
      throw new PublicCompanyLinkError(
        "invalid",
        "The issuer lookup could not be started.",
      );
    return PublicCompanyMatchSchema.parse({
      id: run.id,
      exposureId,
      status: "pending",
      companyId: null,
      companyName: null,
      sourceUrl: null,
      sourceTitle: null,
      reason: "An issuer lookup is already running. Check the result shortly.",
    });
  }

  async approveRecommendation(subject: string, id: string) {
    const identity = await this.identity(subject);
    const run = await this.db
      .prepare(
        `SELECT exposure_id, expected_review_id, result_json FROM public_company_match_runs WHERE id = ? AND household_id = ?`,
      )
      .bind(id, identity.household_id)
      .first<{
        exposure_id: string;
        expected_review_id: string | null;
        result_json: string | null;
      }>();
    if (!run?.result_json)
      throw new PublicCompanyLinkError(
        "not_found",
        "The issuer recommendation is unavailable.",
      );
    const match = PublicCompanyMatchSchema.parse(JSON.parse(run.result_json));
    if (match.status !== "recommended" || match.companyId === null)
      throw new PublicCompanyLinkError(
        "invalid",
        "There is no confident issuer match to approve.",
      );
    const previous = await this.db
      .prepare(
        `SELECT id, public_exposure_id AS exposureId, company_id AS companyId, reviewed_at AS reviewedAt FROM public_exposure_company_reviews WHERE recommendation_id = ? AND household_id = ?`,
      )
      .bind(id, identity.household_id)
      .first();
    if (previous !== null)
      return PublicCompanyLinkReceiptSchema.parse(previous);
    const reviewId = crypto.randomUUID();
    const reviewedAt = new Date().toISOString();
    try {
      await this.db
        .prepare(
          `INSERT INTO public_exposure_company_reviews (id, household_id, public_exposure_id, company_id, source_url, reason, expected_review_id, reviewer_user_id, reviewed_at, recommendation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          reviewId,
          identity.household_id,
          run.exposure_id,
          match.companyId,
          match.sourceUrl ?? `keel:company-names:${match.companyId}`,
          match.reason,
          run.expected_review_id,
          identity.user_id,
          reviewedAt,
          id,
        )
        .run();
    } catch (error) {
      const accepted = await this.db
        .prepare(
          `SELECT id, public_exposure_id AS exposureId, company_id AS companyId, reviewed_at AS reviewedAt FROM public_exposure_company_reviews WHERE recommendation_id = ? AND household_id = ?`,
        )
        .bind(id, identity.household_id)
        .first();
      if (accepted !== null)
        return PublicCompanyLinkReceiptSchema.parse(accepted);
      if (String(error).includes("stale"))
        throw new PublicCompanyLinkError(
          "stale",
          "Company evidence changed. Check the recommendation again.",
        );
      throw error;
    }
    return PublicCompanyLinkReceiptSchema.parse({
      id: reviewId,
      exposureId: run.exposure_id,
      companyId: match.companyId,
      reviewedAt,
    });
  }

  async review(subject: string, rawInput: PublicCompanyLinkReview) {
    const input = PublicCompanyLinkReviewSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const { catalog } = await this.catalogFor(identity.household_id);
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
