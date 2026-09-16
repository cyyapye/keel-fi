import { z } from "zod";

const Id = z.string().min(1).max(500);
const Name = z.string().trim().min(1).max(1_000);

// Match SQLite lower(trim(...)): case/outer ASCII spaces are formatting, while
// punctuation, suffixes and brand similarity only suggest a review.
export function companyNameKey(name: string): string {
  return name
    .replace(/^ +| +$/gu, "")
    .replace(/[A-Z]/gu, (c) => c.toLowerCase());
}
export function companySuggestionKey(name: string): string {
  const words = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u);
  const suffixes = new Set([
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "llc",
    "llp",
    "lp",
    "ltd",
    "limited",
    "plc",
    "gmbh",
    "pte",
    "pty",
  ]);
  while (words.length > 1 && suffixes.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}
export const CompanyIdentityChoiceSchema = z
  .object({
    id: Id,
    legalName: Name,
    aliases: z.array(Name).max(10_000).optional(),
  })
  .strict();
export type CompanyIdentityChoice = z.infer<typeof CompanyIdentityChoiceSchema>;

export function matchingCompanies<T extends CompanyIdentityChoice>(
  companies: readonly T[],
  name: string,
): T[] {
  const key = companyNameKey(name);
  return companies.filter((company) =>
    [company.legalName, ...(company.aliases ?? [])].some(
      (value) => companyNameKey(value) === key,
    ),
  );
}
export function suggestedCompanyGroups(
  companies: readonly CompanyIdentityChoice[],
): string[][] {
  const groups = new Map<string, string[]>();
  for (const company of companies) {
    const key = companySuggestionKey(company.legalName);
    const group = groups.get(key) ?? [];
    group.push(company.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}
export const CompanyIdentityCatalogSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    companies: z.array(CompanyIdentityChoiceSchema).max(5_000),
    suggestedGroups: z.array(z.array(Id).min(2).max(5_000)).max(2_500),
  })
  .strict();
export const CompanyAliasProposalSchema = z
  .object({
    companyId: Id,
    aliasName: Name,
    sourceCompanyId: Id.nullable(),
  })
  .strict();
export const CompanyAliasPreviewSchema = CompanyAliasProposalSchema.extend({
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  companyName: Name,
  sourceCompanyName: Name.nullable(),
  aliases: z.array(Name).max(10_000),
  positions: z.array(z.object({ id: Id, label: Name }).strict()).max(500),
}).strict();
export const CompanyAliasReviewInputSchema = CompanyAliasProposalSchema.extend({
  requestId: z.string().uuid(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
  reason: z.string().trim().min(1).max(1_000),
}).strict();
export const CompanyAliasReceiptSchema = CompanyAliasPreviewSchema.extend({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  reason: z.string().min(1).max(1_000),
  recordedAt: z.iso.datetime({ offset: true }),
}).strict();
export type CompanyIdentityCatalog = z.infer<
  typeof CompanyIdentityCatalogSchema
>;
export type CompanyAliasProposal = z.infer<typeof CompanyAliasProposalSchema>;
export type CompanyAliasPreview = z.infer<typeof CompanyAliasPreviewSchema>;
export type CompanyAliasReviewInput = z.infer<
  typeof CompanyAliasReviewInputSchema
>;
export type CompanyAliasReceipt = z.infer<typeof CompanyAliasReceiptSchema>;
