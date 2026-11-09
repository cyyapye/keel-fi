import { z } from "zod";
import { IsoTimestampSchema, NonNegativeMoneyMinorSchema } from "./index";

export const CashBalanceHistoryQuerySchema = z
  .object({
    kind: z.enum(["bank", "brokerage"]),
    id: z.string().min(1).max(200),
    limit: z.coerce
      .number()
      .int()
      .refine((n) => n === 5 || n === 10)
      .default(5),
    after: z.string().min(1).max(200).optional(),
    revision: z.string().min(1).max(200).optional(),
  })
  .strict();
export const CashBalanceHistoryEntrySchema = z.object({
  id: z.string().min(1),
  observedAt: IsoTimestampSchema,
  acceptedAt: IsoTimestampSchema,
  valueMinor: NonNegativeMoneyMinorSchema.nullable(),
  previousValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  initial: z.boolean(),
});
export const CashBalanceHistoryPageSchema = z.object({
  entries: z.array(CashBalanceHistoryEntrySchema).max(10),
  total: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  firstRecordedAt: IsoTimestampSchema.nullable(),
  next: z.string().min(1).nullable(),
});
export type CashBalanceHistoryEntry = z.infer<
  typeof CashBalanceHistoryEntrySchema
>;
export type CashBalanceHistoryPage = z.infer<
  typeof CashBalanceHistoryPageSchema
>;
export type CashBalanceHistoryQuery = z.infer<
  typeof CashBalanceHistoryQuerySchema
>;
export class CashBalanceHistoryCursorError extends Error {}

/** Project accepted observations only. A check with the same balance is not a change. */
export function cashBalanceHistoryPage(
  observations: readonly {
    id: string;
    observedAt: string;
    acceptedAt: string;
    valueMinor: number | null;
    order?: string;
  }[],
  limit: number,
  after?: string,
  through?: string,
): CashBalanceHistoryPage {
  let ordered = [...observations].sort(
    (a, b) =>
      a.acceptedAt.localeCompare(b.acceptedAt) ||
      a.observedAt.localeCompare(b.observedAt) ||
      (a.order ?? "").localeCompare(b.order ?? "") ||
      a.id.localeCompare(b.id),
  );
  if (through !== undefined) {
    const end = ordered.findIndex((observation) => observation.id === through);
    if (end === -1)
      throw new CashBalanceHistoryCursorError(
        "The requested balance revision is unavailable.",
      );
    ordered = ordered.slice(0, end + 1);
  }
  const entries: CashBalanceHistoryEntry[] = [];
  for (const observation of ordered) {
    const previous = entries.at(-1);
    if (previous && previous.valueMinor === observation.valueMinor) continue;
    entries.push({
      ...observation,
      previousValueMinor: previous?.valueMinor ?? null,
      initial: previous === undefined,
    });
  }
  const firstRecordedAt = entries[0]?.observedAt ?? null;
  entries.reverse();
  const start =
    after === undefined
      ? 0
      : entries.findIndex((entry) => entry.id === after) + 1;
  if (after !== undefined && start === 0)
    throw new CashBalanceHistoryCursorError(
      "History cursor is no longer available.",
    );
  const page = entries.slice(start, start + limit);
  return CashBalanceHistoryPageSchema.parse({
    entries: page,
    total: entries.length,
    start,
    firstRecordedAt,
    next: start + page.length < entries.length ? page.at(-1)!.id : null,
  });
}
