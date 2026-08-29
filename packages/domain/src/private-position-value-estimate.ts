import { z } from "zod";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1_000;
export const PRIVATE_TRANCHE_MATCH_MAX_DAYS = 183;

const IsoDateSchema = z.iso.date();
const NonNegativeMoneyMinorSchema = z.number().int().safe().nonnegative();
const PositiveMoneyMinorSchema = z.number().int().safe().positive();

export const PrivateCompanyRoundValuationSchema = z.object({
  companyId: z.string().min(1),
  evidenceEventId: z.string().min(1),
  effectiveDate: IsoDateSchema,
  postMoneyValueMinor: PositiveMoneyMinorSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  sourceTitle: z.string().trim().min(1).max(1_000),
  sourceUrl: z.url().max(2_048),
  approximate: z.boolean(),
});

export const PrivatePositionEstimateCandidateSchema = z.object({
  positionId: z.string().min(1),
  companyId: z.string().min(1),
  openedOn: IsoDateSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  costBasisMinor: PositiveMoneyMinorSchema,
  currentValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  markEffectiveDate: IsoDateSchema.nullable(),
  markSourceLabel: z.string().trim().min(1).max(1_000).nullable(),
  estimateEligible: z.boolean(),
});

const MatchedRoundSchema = z.object({
  evidenceEventId: z.string().min(1),
  effectiveDate: IsoDateSchema,
  postMoneyValueMinor: PositiveMoneyMinorSchema,
  sourceTitle: z.string().trim().min(1).max(1_000),
  sourceUrl: z.url().max(2_048),
  approximate: z.boolean(),
  distanceDays: z.number().int().nonnegative(),
});

export const PrivatePositionValueEstimateSchema = z.object({
  method: z.literal("gp_mark_tranche_ratio"),
  positionId: z.string().min(1),
  valueMinor: NonNegativeMoneyMinorSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  effectiveDate: IsoDateSchema,
  costBasisMinor: PositiveMoneyMinorSchema,
  impliedCompanyValueMinor: PositiveMoneyMinorSchema,
  referencePositionId: z.string().min(1),
  referenceValueMinor: NonNegativeMoneyMinorSchema,
  referenceCostBasisMinor: PositiveMoneyMinorSchema,
  referenceSourceLabel: z.string().trim().min(1).max(1_000),
  referenceRound: MatchedRoundSchema,
  positionRound: MatchedRoundSchema,
  approximate: z.boolean(),
});

export type PrivateCompanyRoundValuation = z.infer<
  typeof PrivateCompanyRoundValuationSchema
>;
export type PrivatePositionEstimateCandidate = z.infer<
  typeof PrivatePositionEstimateCandidateSchema
>;
export type PrivatePositionValueEstimate = z.infer<
  typeof PrivatePositionValueEstimateSchema
>;

function dateOrdinal(value: string): number {
  return Date.parse(`${IsoDateSchema.parse(value)}T00:00:00.000Z`);
}

function matchedRound(
  candidate: PrivatePositionEstimateCandidate,
  valuations: readonly PrivateCompanyRoundValuation[],
): z.infer<typeof MatchedRoundSchema> | null {
  const openedAt = dateOrdinal(candidate.openedOn);
  const matches = valuations
    .filter(
      (valuation) =>
        valuation.companyId === candidate.companyId &&
        valuation.currency === candidate.currency,
    )
    .map((valuation) => ({
      valuation,
      distanceDays: Math.floor(
        Math.abs(dateOrdinal(valuation.effectiveDate) - openedAt) /
          MILLIS_PER_DAY,
      ),
    }))
    .filter(
      ({ distanceDays }) => distanceDays <= PRIVATE_TRANCHE_MATCH_MAX_DAYS,
    )
    .sort((left, right) => {
      if (left.distanceDays !== right.distanceDays) {
        return left.distanceDays - right.distanceDays;
      }
      const effectiveDate = right.valuation.effectiveDate.localeCompare(
        left.valuation.effectiveDate,
      );
      return effectiveDate === 0
        ? left.valuation.evidenceEventId.localeCompare(
            right.valuation.evidenceEventId,
          )
        : effectiveDate;
    });
  const selected = matches[0];
  if (selected === undefined) {
    return null;
  }
  return MatchedRoundSchema.parse({
    evidenceEventId: selected.valuation.evidenceEventId,
    effectiveDate: selected.valuation.effectiveDate,
    postMoneyValueMinor: selected.valuation.postMoneyValueMinor,
    sourceTitle: selected.valuation.sourceTitle,
    sourceUrl: selected.valuation.sourceUrl,
    approximate: selected.valuation.approximate,
    distanceDays: selected.distanceDays,
  });
}

function roundedRatio(
  amount: number,
  numerator: number,
  denominator: number,
  label: string,
): number {
  const result =
    (BigInt(amount) * BigInt(numerator) + BigInt(denominator) / 2n) /
    BigInt(denominator);
  const value = Number(result);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} exceeds safe integer limits.`);
  }
  return value;
}

export function estimatePrivatePositionValues(
  rawCandidates: readonly PrivatePositionEstimateCandidate[],
  rawValuations: readonly PrivateCompanyRoundValuation[],
): readonly PrivatePositionValueEstimate[] {
  const candidates =
    PrivatePositionEstimateCandidateSchema.array().parse(rawCandidates);
  const valuations =
    PrivateCompanyRoundValuationSchema.array().parse(rawValuations);
  const matchedByPositionId = new Map(
    candidates.flatMap((candidate) => {
      const round = matchedRound(candidate, valuations);
      return round === null ? [] : [[candidate.positionId, round] as const];
    }),
  );
  const anchorsByCompany = new Map<
    string,
    Array<{
      candidate: PrivatePositionEstimateCandidate;
      round: z.infer<typeof MatchedRoundSchema>;
    }>
  >();
  for (const candidate of candidates) {
    const round = matchedByPositionId.get(candidate.positionId);
    if (
      round === undefined ||
      candidate.currentValueMinor === null ||
      candidate.markEffectiveDate === null ||
      candidate.markSourceLabel === null
    ) {
      continue;
    }
    const anchors = anchorsByCompany.get(candidate.companyId) ?? [];
    anchors.push({ candidate, round });
    anchorsByCompany.set(candidate.companyId, anchors);
  }
  for (const anchors of anchorsByCompany.values()) {
    anchors.sort((left, right) => {
      const effectiveDate = right.candidate.markEffectiveDate!.localeCompare(
        left.candidate.markEffectiveDate!,
      );
      return effectiveDate === 0
        ? left.candidate.positionId.localeCompare(right.candidate.positionId)
        : effectiveDate;
    });
  }

  return candidates.flatMap((candidate) => {
    if (!candidate.estimateEligible) {
      return [];
    }
    const positionRound = matchedByPositionId.get(candidate.positionId);
    const anchor = anchorsByCompany.get(candidate.companyId)?.[0];
    if (positionRound === undefined || anchor === undefined) {
      return [];
    }
    const referenceValueMinor = anchor.candidate.currentValueMinor!;
    const impliedCompanyValueMinor = roundedRatio(
      anchor.round.postMoneyValueMinor,
      referenceValueMinor,
      anchor.candidate.costBasisMinor,
      "Implied company value",
    );
    if (impliedCompanyValueMinor === 0) {
      return [];
    }
    const valueMinor = roundedRatio(
      candidate.costBasisMinor,
      impliedCompanyValueMinor,
      positionRound.postMoneyValueMinor,
      "Estimated position value",
    );
    return [
      PrivatePositionValueEstimateSchema.parse({
        method: "gp_mark_tranche_ratio",
        positionId: candidate.positionId,
        valueMinor,
        currency: candidate.currency,
        effectiveDate: anchor.candidate.markEffectiveDate,
        costBasisMinor: candidate.costBasisMinor,
        impliedCompanyValueMinor,
        referencePositionId: anchor.candidate.positionId,
        referenceValueMinor,
        referenceCostBasisMinor: anchor.candidate.costBasisMinor,
        referenceSourceLabel: anchor.candidate.markSourceLabel,
        referenceRound: anchor.round,
        positionRound,
        approximate:
          anchor.round.approximate ||
          positionRound.approximate ||
          anchor.round.distanceDays > 0 ||
          positionRound.distanceDays > 0,
      }),
    ];
  });
}
