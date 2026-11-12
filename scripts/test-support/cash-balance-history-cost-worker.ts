import { z } from "zod";
import { D1CashAccountsRepository } from "../../packages/database/src/cash-accounts";
import { addMinorUnits } from "../../packages/domain/src/index";
import { seedCostHoldings, syntheticDigest } from "./cost-fixtures";

const subject = "synthetic-access-subject";
const setup = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("bank"),
      subject: z.enum([subject, "synthetic-other-history"]),
      start: z.union([z.literal(0), z.literal(8)]),
      end: z.union([z.literal(8), z.literal(16)]),
    })
    .strict()
    .refine(
      (input) =>
        (input.start === 0 && input.end === 8) ||
        (input.start === 8 && input.end === 16),
    ),
  z
    .object({
      operation: z.literal("holdings"),
      revision: z.number().int().min(1).max(4),
    })
    .strict(),
]);

// Synthetic setup uses the same production operations beside D1. Every read
// holdout, counter and query-plan assertion remains in the calling test.
async function seedBank(
  database: D1Database,
  who: string,
  start: number,
  end: number,
) {
  const repository = new D1CashAccountsRepository(database, "free");
  const connection =
    start === 0
      ? await repository.upsertConnection(
          who,
          "Synthetic history bank",
          "synthetic-only/cash-history",
          syntheticDigest(who === subject ? 1000 : 2000),
        )
      : (await repository.getState(who, true)).connections[0]!;
  for (let revision = start; revision < end; revision++) {
    const observedAt = `2026-08-${String(revision + 1).padStart(2, "0")}T12:00:00.000Z`;
    const run = await repository.beginRefresh(
      who,
      connection.id,
      revision === 0 ? "initial" : "live",
    );
    const staged = await repository.stageProposal(who, run.id, {
      objectKey: `synthetic-history/${who}/${revision}.json`,
      sourceSha256: syntheticDigest(revision + 100),
      normalized: {
        normalizedFingerprint: syntheticDigest(revision + 200),
        observedAt,
        rows: Array.from({ length: 100 }, (_, i) => ({
          naturalKeySha256: syntheticDigest(i + 1),
          itemAccountKeySha256: syntheticDigest(i + 1),
          institutionLabel: "Synthetic history bank",
          accountLabel: `Synthetic account ${i}`,
          subtype: "checking" as const,
          availableMinor: addMinorUnits(10000, revision),
          currentMinor: addMinorUnits(10000, revision),
          valueMinor: addMinorUnits(10000, revision),
          valueState: "reported" as const,
          balanceSource: "available" as const,
          observedAt,
          issues: [],
        })),
      },
    });
    if (!staged.proposal) throw new Error("Missing synthetic proposal");
    await repository.completeRefresh(who, run.id, staged.proposal.id, 100);
    if (revision === 0)
      await repository.applyProposal(who, staged.proposal.id, {
        changeNote: "Accepted synthetic history accounts",
        decisions: staged.proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
        })),
      });
    else await repository.applyAutomaticUpdates(who);
  }
  const state = await repository.getState(who, true);
  return {
    accountId: state.acceptedAccounts[0]!.id,
    accounts: state.acceptedAccounts.length,
  };
}

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const input = setup.parse(await request.json());
    if (input.operation === "bank") {
      return Response.json({
        operation: input.operation,
        ...(await seedBank(bindings.DB, input.subject, input.start, input.end)),
      });
    }
    const importId = await seedCostHoldings(
      bindings.DB,
      subject,
      input.revision,
      false,
      { instrument: "cash" },
    );
    return Response.json({ operation: input.operation, importId });
  },
};
