import { afterEach, beforeEach, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { seedAutomaticInvestments } from "../../../scripts/test-support/automatic-investments";
import { D1AutomaticInvestmentReviewRepository } from "./automatic-investment-review";
import { D1InvestmentReviewRepository } from "./investment-review";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1LegalEntityRepository } from "./legal-entities";
import {
  D1CompanyIdentityRepository,
  companyAliasMappingsSql,
  companyIdentityChoicesSql,
} from "./company-identity";
import {
  matchingCompanies,
  suggestedCompanyGroups,
} from "@keel/domain/company-identity";

let d1: LegalDocumentTestD1;
let repository: D1CompanyIdentityRepository;
const subject = "synthetic-access-subject";
const now = "2026-09-01T12:00:00.000Z";
function company(id: string, name: string, household = "hh_demo") {
  d1.sqlite
    .prepare(`INSERT INTO companies VALUES (?, ?, ?, NULL, 'active', ?, ?)`)
    .run(id, household, name, now, now);
}
async function alias(
  sourceCompanyId: string | null,
  companyId: string,
  aliasName: string,
) {
  const proposal = { companyId, sourceCompanyId, aliasName };
  const preview = await repository.preview(subject, proposal);
  const input = {
    ...proposal,
    expectedRevision: preview.revision,
    requestId: crypto.randomUUID(),
    reason: "Reviewed synthetic company identity.",
  };
  return { input, receipt: await repository.review(subject, input) };
}
beforeEach(() => {
  d1 = legalDocumentTestDatabase();
  repository = new D1CompanyIdentityRepository(d1.asD1());
});
afterEach(() => d1.sqlite.close());

it("groups companies only after review, reuses arbitrary aliases and flattens later regrouping", async () => {
  company("synth-main", "Synthetic Cedar");
  company("synth-inc", "Synthetic Cedar Inc.");
  company("synth-final", "Synthetic Cedar Group");
  const before = await repository.getCatalog(subject);
  expect(suggestedCompanyGroups(before.companies)).toContainEqual([
    "synth-main",
    "synth-inc",
  ]);
  expect(matchingCompanies(before.companies, "Synthetic Cedar LLC")).toEqual(
    [],
  );
  const reviewed = await alias(
    "synth-inc",
    "synth-main",
    "Synthetic Cedar Inc.",
  );
  expect(await repository.review(subject, reviewed.input)).toEqual(
    reviewed.receipt,
  );
  await alias(null, "synth-main", "Synthetic Cedar International, LLC");
  await alias("synth-main", "synth-final", "Synthetic Cedar");
  const after = await repository.getCatalog(subject);
  expect(after.companies.filter((c) => c.id.startsWith("synth-"))).toEqual([
    {
      id: "synth-final",
      legalName: "Synthetic Cedar Group",
      aliases: expect.arrayContaining([
        "Synthetic Cedar Inc.",
        "Synthetic Cedar International, LLC",
        "Synthetic Cedar",
      ]),
    },
  ]);
  expect(
    matchingCompanies(after.companies, "synthetic cedar inc.").map((c) => c.id),
  ).toEqual(["synth-final"]);
  expect(() => company("recreated", "synthetic cedar inc.")).toThrow(
    /alias exists/u,
  );
  expect(() => d1.sqlite.exec("DELETE FROM company_alias_reviews")).toThrow(
    /append only/u,
  );
  await expect(
    repository.preview(subject, {
      companyId: "synth-inc",
      sourceCompanyId: null,
      aliasName: "New name",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
});

it("preserves positions, values, source citations and historical decisions when consolidating an existing company", async () => {
  const ids = await seedAutomaticInvestments(d1.asD1(), 2, [], true);
  await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
  const reviews = new D1InvestmentReviewRepository(d1.asD1());
  const original = await reviews.getContext(subject, ids[0]!);
  const oldCompany = original.mappings.find((m) => m.status === "active")!;
  company("synthetic-canonical", "Synthetic Orchard");
  const positions = d1.sqlite
    .prepare("SELECT * FROM holding_positions ORDER BY id")
    .all();
  const snapshots = d1.sqlite
    .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
    .all();
  const historical = d1.sqlite
    .prepare("SELECT * FROM holding_position_exposure_mappings ORDER BY id")
    .all();
  const proposal = {
    sourceCompanyId: oldCompany.companyId!,
    companyId: "synthetic-canonical",
    aliasName: oldCompany.companyName,
  };
  const preview = await repository.preview(subject, proposal);
  expect(preview.positions).toHaveLength(2);
  await alias(proposal.sourceCompanyId, proposal.companyId, proposal.aliasName);
  const current = await reviews.getContext(subject, ids[0]!);
  expect(current.mappings.filter((m) => m.status === "active")).toEqual([
    expect.objectContaining({
      companyId: "synthetic-canonical",
      companyName: "Synthetic Orchard",
    }),
  ]);
  expect(current.companyReceipt).toMatchObject({
    companyId: "synthetic-canonical",
    companyAliasReviewId: expect.any(String),
    citation: original.companyReceipt!.citation,
    sourceDocument: original.companyReceipt!.sourceDocument,
  });
  const positionView = await new D1InvestmentPositionViewRepository(
    d1.asD1(),
  ).list(subject);
  const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
    subject,
    positionView,
  );
  expect([
    ...inventory.entities.flatMap((entity) => entity.sources),
    ...inventory.candidates,
  ]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        companyReview: expect.objectContaining({
          companyId: "synthetic-canonical",
          citation: original.companyReceipt!.citation,
        }),
      }),
    ]),
  );
  expect(
    d1.sqlite.prepare("SELECT * FROM holding_positions ORDER BY id").all(),
  ).toEqual(positions);
  expect(
    d1.sqlite
      .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
      .all(),
  ).toEqual(snapshots);
  expect(
    d1.sqlite
      .prepare("SELECT * FROM holding_position_exposure_mappings ORDER BY id")
      .all(),
  ).toEqual(expect.arrayContaining(historical));
  await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
  expect(
    (await reviews.getContext(subject, ids[0]!)).automaticReview?.issues.filter(
      (i) => i.section === "company",
    ),
  ).toEqual([]);
  await expect(
    reviews.reviewCompany(subject, ids[0]!, {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: current.snapshotId,
      expectedEvidenceRevision: current.evidenceRevision,
      expectedMappingIds: current.mappings.map((m) => m.id),
      company: { mode: "new", legalName: proposal.aliasName },
      basis: "user_confirmed",
      citation: null,
      reason: null,
    }),
  ).rejects.toMatchObject({ code: "invalid_evidence" });
});

it("rejects a mapping changed after preview without saving an alias decision", async () => {
  const ids = await seedAutomaticInvestments(d1.asD1(), 1, [], true);
  await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
  const context = await new D1InvestmentReviewRepository(d1.asD1()).getContext(
    subject,
    ids[0]!,
  );
  const old = context.mappings.find((mapping) => mapping.status === "active")!;
  company("synthetic-canonical", "Synthetic Orchard");
  const proposal = {
    companyId: "synthetic-canonical",
    sourceCompanyId: old.companyId!,
    aliasName: old.companyName,
  };
  const preview = await repository.preview(subject, proposal);
  d1.beforeBatch = () => {
    d1.sqlite
      .prepare(
        `INSERT INTO holding_position_exposure_mappings
      SELECT 'synthetic-racing-mapping', household_id, position_id, exposure_id, relationship_kind, NULL, 'withdrawn', decision_source, decision_reference, evidence_sha256, effective_at, version + 1, id, accepted_by_user_id, accepted_at, immutable
      FROM holding_position_exposure_mappings WHERE id = ?`,
      )
      .run(old.id);
  };
  await expect(
    repository.review(subject, {
      ...proposal,
      requestId: crypto.randomUUID(),
      expectedRevision: preview.revision,
      reason: "Synthetic review",
    }),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    d1.sqlite.prepare("SELECT * FROM company_alias_reviews").all(),
  ).toEqual([]);
  expect(d1.sqlite.prepare("SELECT * FROM company_aliases").all()).toEqual([]);
});

it("does not attach a different company's agreement citation to a grouped multi-company position", async () => {
  const ids = await seedAutomaticInvestments(d1.asD1(), 1, [], true);
  await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
  const reviews = new D1InvestmentReviewRepository(d1.asD1());
  const original = await reviews.getContext(subject, ids[0]!);
  const old = original.mappings.find((mapping) => mapping.status === "active")!;
  company("synthetic-second", "Synthetic Second Inc.");
  company("synthetic-canonical", "Synthetic Second");
  d1.sqlite
    .prepare(
      `INSERT INTO canonical_exposures SELECT 'synthetic-second-exposure', household_id, exposure_kind, 'Synthetic Second Inc.', protected_identity_key, 'synthetic-second', resolution_method, evidence_sha256, created_by_user_id, created_at, immutable FROM canonical_exposures WHERE id = (SELECT exposure_id FROM holding_position_exposure_mappings WHERE id = ?)`,
    )
    .run(old.id);
  d1.sqlite
    .prepare(
      `INSERT INTO holding_position_exposure_mappings SELECT 'synthetic-second-mapping', household_id, position_id, 'synthetic-second-exposure', relationship_kind, NULL, 'active', decision_source, decision_reference, evidence_sha256, effective_at, 1, NULL, accepted_by_user_id, accepted_at, immutable FROM holding_position_exposure_mappings WHERE id = ?`,
    )
    .run(old.id);
  await alias(
    "synthetic-second",
    "synthetic-canonical",
    "Synthetic Second Inc.",
  );
  const current = await reviews.getContext(subject, ids[0]!);
  expect(
    current.mappings.filter((mapping) => mapping.status === "active"),
  ).toHaveLength(2);
  expect(current.companyReceipt).toMatchObject({
    companyId: "synthetic-canonical",
    basis: "user_confirmed",
    citation: null,
    sourceDocument: null,
  });
  expect(
    d1.sqlite
      .prepare(
        "SELECT details_json FROM automatic_investment_reviews WHERE position_id = ? ORDER BY version DESC LIMIT 1",
      )
      .get(ids[0]!),
  ).toEqual(
    expect.objectContaining({
      details_json: expect.stringContaining(
        original.companyReceipt!.citation!.quote,
      ),
    }),
  );
});

it("rejects cross-household, changed retry payloads and a racing company decision without partial writes", async () => {
  company("synth-main", "Synthetic Maple");
  company("synth-inc", "Synthetic Maple Inc.");
  d1.sqlite.exec(
    `INSERT INTO users VALUES ('other-user', 'other-subject', 'other@example.invalid', 'Synthetic Other', '${now}'); INSERT INTO households VALUES ('other-household', 'other-user', 'Other Household', 'USD', '${now}')`,
  );
  company("synth-other", "Synthetic Other", "other-household");
  await expect(
    repository.preview(subject, {
      companyId: "synth-other",
      sourceCompanyId: "synth-inc",
      aliasName: "Synthetic Maple Inc.",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  const proposal = {
    companyId: "synth-main",
    sourceCompanyId: "synth-inc",
    aliasName: "Synthetic Maple Inc.",
  };
  const preview = await repository.preview(subject, proposal);
  const input = {
    ...proposal,
    requestId: crypto.randomUUID(),
    expectedRevision: preview.revision,
    reason: "Synthetic review",
  };
  d1.beforeBatch = () => company("racing", "Synthetic Racing");
  await expect(repository.review(subject, input)).rejects.toMatchObject({
    code: "stale",
  });
  expect(
    d1.sqlite.prepare("SELECT * FROM company_alias_reviews").all(),
  ).toEqual([]);
  expect(d1.sqlite.prepare("SELECT * FROM company_redirects").all()).toEqual(
    [],
  );
  const result = await alias("synth-inc", "synth-main", "Synthetic Maple Inc.");
  await expect(
    repository.review(subject, { ...result.input, reason: "Changed payload" }),
  ).rejects.toMatchObject({ code: "stale" });
});

it("reads at least 120 companies in three indexed projection queries and keeps similar names separate", async () => {
  for (let index = 0; index < 120; index++)
    company(`synthetic-company-${index}`, `Synthetic Business ${index}`);
  company("similar-one", "Synthetic Birch");
  company("similar-two", "Synthetic Birch LLC");
  const count = d1.queries.length;
  const catalog = await repository.getCatalog(subject);
  expect(catalog.companies.length).toBeGreaterThanOrEqual(122);
  expect(d1.queries.length - count).toBe(3);
  expect(catalog.suggestedGroups).toContainEqual([
    "similar-one",
    "similar-two",
  ]);
  expect(
    d1.sqlite.prepare("SELECT COUNT(*) count FROM company_alias_reviews").get(),
  ).toEqual({ count: 0 });
  const explain = d1.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${companyIdentityChoicesSql}`)
    .all("hh_demo");
  expect(JSON.stringify(explain)).toContain("company_aliases_company_idx");
  expect(JSON.stringify(explain)).not.toMatch(/SCAN a\b/u);
  const mappings = d1.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${companyAliasMappingsSql}`)
    .all("hh_demo", "similar-one", "similar-two");
  expect(JSON.stringify(mappings)).toContain("company_alias_mapping_roots_idx");
  expect(JSON.stringify(mappings)).not.toMatch(
    /SCAN (root|m|receipt|mapping)\b/u,
  );
});

it("holds an unfamiliar suffix for review and then reuses its approved company identity during automatic acceptance", async () => {
  company("synthetic-friendly", "Synthetic Orchard");
  const ids = await seedAutomaticInvestments(d1.asD1(), 1, [], true);
  const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
  const reviews = new D1InvestmentReviewRepository(d1.asD1());
  await automatic.resolve(subject);
  const unresolved = await reviews.getContext(subject, ids[0]!);
  expect(unresolved.automaticReview?.issues).toContainEqual(
    expect.objectContaining({ section: "company", code: "conflicting" }),
  );
  expect(
    (await repository.getCatalog(subject)).companies.filter((c) =>
      c.legalName.startsWith("Synthetic Orchard"),
    ),
  ).toHaveLength(1);
  await alias(null, "synthetic-friendly", "Synthetic Orchard Inc.");
  await automatic.resolve(subject);
  const accepted = await reviews.getContext(subject, ids[0]!);
  expect(accepted.companyReceipt).toMatchObject({
    companyId: "synthetic-friendly",
    companyName: "Synthetic Orchard",
    basis: "document_link",
    citation: { companyName: "Synthetic Orchard Inc." },
  });
  expect(accepted.mappings.filter((m) => m.status === "active")).toEqual([
    expect.objectContaining({ companyId: "synthetic-friendly" }),
  ]);
});
