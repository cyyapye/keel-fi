import { z } from "zod";

const Name = z
  .string()
  .trim()
  .min(1, "Enter the company, security or right name.")
  .max(1_000);
const OptionalText = z.string().trim().min(1).max(2_000).nullable();
// Decimal strings preserve fractional securities without floating point arithmetic.
const Quantity = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/u)
  .nullable();
export const InvestmentEventComponentSchema = z
  .object({
    kind: z.enum(["shares", "warrants", "earnout", "cash", "other"]),
    label: Name,
    quantity: Quantity,
    status: z.enum([
      "received",
      "conditional",
      "released",
      "expired",
      "unknown",
    ]),
    amountMinor: z.number().int().safe().nonnegative().nullable(),
    unitPriceMinor: z.number().int().safe().nonnegative().nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    note: OptionalText,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.kind === "cash" &&
      (value.quantity !== null || value.unitPriceMinor !== null)
    )
      ctx.addIssue({
        code: "custom",
        message: "Cash uses an amount, not a share quantity or price.",
      });
  });

export const InvestmentEventInputSchema = z
  .object({
    eventId: z.string().uuid(),
    supersedesRevisionId: z.string().uuid().nullable(),
    kind: z.enum(["merger", "conversion"]),
    scope: z.literal("underlying_securities"),
    participationContinues: z.literal(true),
    status: z.enum(["announced", "completed", "cancelled"]),
    predecessor: Name,
    successor: Name,
    noticeDate: z.iso.date().nullable(),
    effectiveDate: z.iso.date().nullable(),
    sourceLabel: z.string().trim().min(1).max(240),
    sourceText: z.string().trim().min(10).max(20_000),
    documentId: z.string().uuid().nullable(),
    // The source can explicitly report no distribution, or leave it unknown.
    // Personal payments belong to the cash/distribution ledger, never this event.
    lpDistribution: z.enum(["none_reported", "unknown"]),
    components: z.array(InvestmentEventComponentSchema).max(20),
    note: OptionalText,
    expectedMappingIds: z.array(z.string().min(1).max(500)).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.kind === "merger" &&
      value.predecessor.toLocaleLowerCase() ===
        value.successor.toLocaleLowerCase()
    )
      ctx.addIssue({
        code: "custom",
        path: ["successor"],
        message:
          "Enter the successor security issuer, not an alias of the predecessor.",
      });
    if (
      value.status === "completed" &&
      value.components.length > 0 &&
      value.components.every((component) => component.kind === "cash")
    )
      ctx.addIssue({
        code: "custom",
        path: ["components"],
        message:
          "A cash-only acquisition does not create successor company exposure. Record this conversion only when the SPV retains successor securities or rights.",
      });
    if (
      new Set(value.expectedMappingIds).size !== value.expectedMappingIds.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["expectedMappingIds"],
        message: "Mapping references must be distinct.",
      });
  });
export const InvestmentEventSchema = InvestmentEventInputSchema.safeExtend({
  revisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  recordedAt: z.iso.datetime({ offset: true }),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  documentSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  successorCompanyId: z.string().min(1).max(500).nullable(),
});
export type InvestmentEventInput = z.infer<typeof InvestmentEventInputSchema>;
export type InvestmentEvent = z.infer<typeof InvestmentEventSchema>;
export type InvestmentEventComponent = z.infer<
  typeof InvestmentEventComponentSchema
>;

export function currentInvestmentEvents(events: readonly InvestmentEvent[]) {
  const superseded = new Set(events.map((event) => event.supersedesRevisionId));
  return events.filter((event) => !superseded.has(event.revisionId));
}

// Deliberately bounded extraction of explicit notice wording. Unrecognized
// statements remain visible as source text and editable fields, never guessed facts.
export function suggestInvestmentEvent(
  text: string,
  vehicleName: string,
  currency: string,
) {
  const sourceText = text.trim().slice(0, 20_000);
  const sections = [
    ...sourceText.matchAll(/^For\s+(.+?),?\s+(?:here are|the following)/gimu),
  ];
  const match = sections.find(
    (section) =>
      section[1]!.replace(/,$/u, "").trim().toLocaleLowerCase() ===
      vehicleName.trim().toLocaleLowerCase(),
  );
  let scoped = sourceText;
  let matchedVehicle = sections.length === 0;
  if (match !== undefined) {
    const index = sections.indexOf(match);
    scoped = sourceText.slice(match.index, sections[index + 1]?.index);
    matchedVehicle = true;
  } else if (sections.length > 0) scoped = "";
  const components: InvestmentEventComponent[] = [];
  for (const sentence of scoped.split(/\n|(?<=\.)\s+(?=[A-Z])/u)) {
    const quantity = sentence.match(
      /(?:received|receive|issued)\s+(?:an?\s+)?(?:additional\s+)?([\d,]+(?:\.\d+)?)\s+(.{0,100}?shares)\b/iu,
    );
    if (!quantity) continue;
    const conditional =
      /will receive|upon release|contingent|subject to/iu.test(sentence);
    const kind = /warrant/iu.test(sentence)
      ? "warrants"
      : /earnout|earn-out/iu.test(sentence)
        ? "earnout"
        : "shares";
    const price = sentence.match(
      /\$(\d[\d,]*)(?:\.(\d{1,2}))?\s*(?:per share|\/share)/iu,
    );
    const minor = price
      ? BigInt(price[1]!.replaceAll(",", "")) * 100n +
        BigInt((price[2] ?? "").padEnd(2, "0"))
      : null;
    const item = InvestmentEventComponentSchema.safeParse({
      kind,
      label: kind === "earnout" ? "Earnout shares" : quantity[2]!.trim(),
      quantity: quantity[1]!.replaceAll(",", ""),
      status: conditional ? "conditional" : "received",
      amountMinor: null,
      unitPriceMinor:
        minor !== null && minor <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(minor)
          : null,
      currency,
      note: sentence.trim().slice(0, 2_000),
    });
    if (item.success && components.length < 20) components.push(item.data);
  }
  const namedMerger = sourceText.match(
    /(?:^|\n|Recently\s+)([A-Z][^\n.]{1,120}?)\s+(?:has\s+)?merged with\s+([^\n.]{1,150})/u,
  );
  const isoNotice = sourceText.match(
    /(?:notice date|dated)\s*:?\s*(\d{4}-\d{2}-\d{2})/iu,
  )?.[1];
  const writtenNotice = sourceText.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/u,
  );
  const parsedDate = writtenNotice
    ? new Date(`${writtenNotice[0]} 00:00:00 GMT`)
    : null;
  const noticeDate =
    isoNotice ??
    (parsedDate !== null && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString().slice(0, 10)
      : null);
  return {
    sourceText,
    noticeDate: z.iso.date().safeParse(noticeDate).success ? noticeDate : null,
    predecessor: namedMerger?.[1]?.trim() ?? "",
    status: namedMerger ? ("completed" as const) : ("announced" as const),
    matchedVehicle,
    components,
    successor:
      sourceText
        .match(/(?:merged with|acquired by)\s+([^\n.]{1,150})/iu)?.[1]
        ?.trim() ?? "",
    lpDistribution:
      /not an exit that gives LPs liquidity|no LP liquidity|no (?:cash )?distribution to (?:LPs|investors)/iu.test(
        sourceText,
      )
        ? ("none_reported" as const)
        : ("unknown" as const),
  };
}
