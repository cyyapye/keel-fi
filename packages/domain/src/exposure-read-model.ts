import {
  estimatePurchaseValue,
  ShareValueEstimateSchema,
} from "./position-purchases";
import { investmentAmount } from "./investment-review";
import { z } from "zod";

import {
  CanonicalExposureSchema,
  IsoTimestampSchema,
  NonNegativeMoneyMinorSchema,
  PARTS_PER_MILLION,
  PositionExposureMappingSchema,
  multiplyMinorByScalePpm,
  type CanonicalExposure,
  type PositionExposureMapping,
} from "./index";
import {
  InvestmentPositionConnectionSchema,
  InvestmentPositionContainerSchema,
  InvestmentPositionRecordSchema,
  InvestmentPositionViewSchema,
  type InvestmentPositionRecord,
  type InvestmentPositionView,
} from "./position-read-model";
import { includesCurrentInvestment } from "./investment-review";
import { calculatePositionPerformance } from "./position-economics";
import {
  estimatePrivatePositionValues,
  PrivateCompanyRoundValuationSchema,
  PrivatePositionValueEstimateSchema,
  type PrivateCompanyRoundValuation,
} from "./private-position-value-estimate";

const NullablePositionValueSchema = z
  .object({
    valueState: z.enum(["reported", "locked", "not_reported"]),
    valueMinor: NonNegativeMoneyMinorSchema.nullable(),
    allocatedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    unallocatedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.valueState === "reported") {
      if (
        value.valueMinor === null ||
        value.allocatedValueMinor === null ||
        value.unallocatedValueMinor === null ||
        value.allocatedValueMinor + value.unallocatedValueMinor !==
          value.valueMinor
      ) {
        context.addIssue({
          code: "custom",
          message: "Exposure allocations must preserve the position value.",
          path: ["allocatedValueMinor"],
        });
      }
      return;
    }
    if (
      value.valueMinor !== null ||
      value.allocatedValueMinor !== null ||
      value.unallocatedValueMinor !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Unknown position values cannot be allocated.",
        path: ["valueMinor"],
      });
    }
  });

export const InvestmentExposureMappingViewSchema = z.object({
  id: z.string().min(1),
  exposureId: z.string().min(1),
  relationshipKind: z.enum(["direct", "look_through"]),
  allocationPpm: z
    .number()
    .int()
    .safe()
    .min(0)
    .max(PARTS_PER_MILLION)
    .nullable(),
  decisionSource: z.enum(["deterministic_policy", "review"]),
  decisionReference: z.string().trim().min(1).max(200),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  effectiveAt: IsoTimestampSchema,
  version: z.number().int().positive(),
});

export const InvestmentExposurePositionSchema = z
  .object({
    id: z.string().min(1),
    connectionId: z.string().min(1),
    adapterType: InvestmentPositionConnectionSchema.shape.adapterType,
    institutionKey: InvestmentPositionConnectionSchema.shape.institutionKey,
    institutionLabel: InvestmentPositionConnectionSchema.shape.institutionLabel,
    connectionState: InvestmentPositionConnectionSchema.shape.lifecycleState,
    containerId: z.string().min(1),
    containerLabel: InvestmentPositionContainerSchema.shape.label,
    containerKind: InvestmentPositionContainerSchema.shape.kind,
    taxTreatment: InvestmentPositionContainerSchema.shape.taxTreatment,
    coverage: InvestmentPositionContainerSchema.shape.coverage,
    legalVehicleName: InvestmentPositionRecordSchema.shape.legalVehicleName,
    openedOn: InvestmentPositionRecordSchema.shape.openedOn,
    reportedExposureName:
      InvestmentPositionRecordSchema.shape.reportedExposureName,
    positionKind: InvestmentPositionRecordSchema.shape.kind,
    ownershipBasis: InvestmentPositionRecordSchema.shape.ownershipBasis,
    sourceLabel: InvestmentPositionRecordSchema.shape.source.shape.label,
    sourceFreshness:
      InvestmentPositionRecordSchema.shape.source.shape.freshness,
    snapshotId: InvestmentPositionRecordSchema.shape.snapshot.shape.id,
    snapshotFingerprint:
      InvestmentPositionRecordSchema.shape.snapshot.shape.fingerprint,
    observedAt: InvestmentPositionRecordSchema.shape.snapshot.shape.observedAt,
    instrumentType:
      InvestmentPositionRecordSchema.shape.snapshot.shape.instrumentType,
    currency: InvestmentPositionRecordSchema.shape.snapshot.shape.currency,
    ticker: InvestmentPositionRecordSchema.shape.snapshot.shape.ticker,
    quantityMicros:
      InvestmentPositionRecordSchema.shape.snapshot.shape.quantityMicros,
    investedMinor:
      InvestmentPositionRecordSchema.shape.snapshot.shape.investedMinor,
    committedMinor:
      InvestmentPositionRecordSchema.shape.snapshot.shape.allocationMinor,
    realizedValueMinor:
      InvestmentPositionRecordSchema.shape.snapshot.shape.realizedValueMinor,
    providerCostBasisMinor:
      InvestmentPositionRecordSchema.shape.snapshot.shape.costBasisMinor,
    acceptedEconomicsTerms:
      InvestmentPositionRecordSchema.shape.acceptedEconomicsTerms,
    reportedEconomicsTerms:
      InvestmentPositionRecordSchema.shape.reportedEconomicsTerms,
    valueSource: z
      .enum([
        "provider",
        "invested_amount",
        "portfolio_watch_estimate",
        "share_price_estimate",
        "reviewed_adjustment",
      ])
      .optional(),
    valueEffectiveDate: z.iso.date().nullable().optional(),
    valueSourceLabel: z.string().trim().min(1).max(240).optional(),
    priorValueState: z
      .enum(["reported", "locked", "not_reported"])
      .nullable()
      .optional(),
    priorValueMinor: NonNegativeMoneyMinorSchema.nullable().optional(),
    priorValueObservedAt: IsoTimestampSchema.nullable().optional(),
    isPrivateCompanyPosition: z.boolean(),
    shareValueEstimate: ShareValueEstimateSchema.nullable().optional(),
    privateValueEstimate: PrivatePositionValueEstimateSchema.nullable(),
    mappings: z.array(InvestmentExposureMappingViewSchema),
    mappedExposureIds: z.array(z.string().min(1)),
    knownAllocationPpm: z.number().int().safe().min(0).max(PARTS_PER_MILLION),
    hasUnknownAllocation: z.boolean(),
  })
  .and(NullablePositionValueSchema);

export const InvestmentExposureContributionSchema = z.object({
  mappingId: z.string().min(1),
  positionId: z.string().min(1),
  exposureId: z.string().min(1),
  relationshipKind: z.enum(["direct", "look_through"]),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  valueState: z.enum(["reported", "locked", "not_reported"]),
  positionValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  allocationPpm: z
    .number()
    .int()
    .safe()
    .min(0)
    .max(PARTS_PER_MILLION)
    .nullable(),
  allocatedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
  decisionSource: z.enum(["deterministic_policy", "review"]),
  decisionReference: z.string().trim().min(1).max(200),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  effectiveAt: IsoTimestampSchema,
  version: z.number().int().positive(),
});

export const InvestmentExposureGroupSchema = z.object({
  exposure: CanonicalExposureSchema,
  contributions: z.array(InvestmentExposureContributionSchema),
  totals: z.array(
    z.object({
      currency: z.string().regex(/^[A-Z]{3}$/u),
      allocatedValueMinor: NonNegativeMoneyMinorSchema,
      knownValuePositionCount: z.number().int().nonnegative(),
      unknownValuePositionCount: z.number().int().nonnegative(),
    }),
  ),
});

export const InvestmentExposureViewSchema = z.object({
  asOf: IsoTimestampSchema,
  positions: z.array(InvestmentExposurePositionSchema),
  exposures: z.array(InvestmentExposureGroupSchema),
  publicCompanyLinks: z
    .array(
      z.object({
        publicExposureId: z.string().min(1),
        companyExposureId: z.string().min(1),
      }),
    )
    .optional(),
});

export type InvestmentExposureContribution = z.infer<
  typeof InvestmentExposureContributionSchema
>;
export type InvestmentExposureGroup = z.infer<
  typeof InvestmentExposureGroupSchema
>;
export type InvestmentExposurePosition = z.infer<
  typeof InvestmentExposurePositionSchema
>;
export type InvestmentExposureView = z.infer<
  typeof InvestmentExposureViewSchema
>;

// Instrument and position identities stay in `exposures`. Reviewed issuer
// links combine their contributions only in this concentration projection.
export function companyExposureGroups(
  view: InvestmentExposureView,
): InvestmentExposureGroup[] {
  const groups = new Map(
    view.exposures.map((group) => [group.exposure.id, group]),
  );
  const targetByPublic = new Map(
    (view.publicCompanyLinks ?? []).map((link) => [
      link.publicExposureId,
      link.companyExposureId,
    ]),
  );
  const combined = new Map<string, InvestmentExposureGroup>();
  for (const group of view.exposures) {
    const targetId = targetByPublic.get(group.exposure.id);
    const target = targetId === undefined ? undefined : groups.get(targetId);
    if (
      targetId !== undefined &&
      (group.exposure.exposureKind !== "public_instrument" ||
        target?.exposure.exposureKind !== "private_company" ||
        group.exposure.householdId !== target.exposure.householdId)
    ) {
      throw new Error("Reviewed issuer link has invalid exposure identities.");
    }
    const displayGroup = target ?? group;
    const key = displayGroup.exposure.id;
    const current = combined.get(key);
    combined.set(key, {
      exposure: displayGroup.exposure,
      contributions: [
        ...(current?.contributions ?? []),
        ...group.contributions,
      ],
      totals: [],
    });
  }
  return [...combined.values()].map((group) => {
    const totals = new Map<
      string,
      { values: bigint; known: Set<string>; unknown: Set<string> }
    >();
    for (const contribution of group.contributions) {
      const total = totals.get(contribution.currency) ?? {
        values: 0n,
        known: new Set<string>(),
        unknown: new Set<string>(),
      };
      if (contribution.allocatedValueMinor === null) {
        total.unknown.add(contribution.positionId);
      } else {
        total.values += BigInt(contribution.allocatedValueMinor);
        total.known.add(contribution.positionId);
      }
      totals.set(contribution.currency, total);
    }
    return {
      ...group,
      totals: [...totals.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, total]) => ({
          currency,
          allocatedValueMinor: NonNegativeMoneyMinorSchema.parse(
            Number(total.values),
          ),
          knownValuePositionCount: total.known.size,
          unknownValuePositionCount: total.unknown.size,
        })),
    };
  });
}

function safeMinorSum(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return NonNegativeMoneyMinorSchema.parse(Number(total));
}

function usesInvestedAmountFallback(
  position: InvestmentPositionRecord,
): boolean {
  return (
    position.snapshot.providerStatus === "live" &&
    position.snapshot.unrealizedValue.state === "not_reported" &&
    position.snapshot.investedMinor > 0 &&
    position.snapshot.instrumentType.trim().toLowerCase() !== "cash"
  );
}

function privatePositionCostBasis(
  position: InvestmentPositionRecord,
): number | null {
  return calculatePositionPerformance({
    currentValueMinor: null,
    currentValueReported: false,
    realizedValueMinor: position.snapshot.realizedValueMinor,
    providerCostBasisMinor: position.snapshot.costBasisMinor,
    fundedMinor: position.snapshot.investedMinor,
    economicsContext:
      position.kind === "spv_interest" && investmentAmount(position) > 0
        ? {
            snapshotId: position.snapshot.id,
            currency: position.snapshot.currency,
            committedMinor: investmentAmount(position),
            amountCorrectionNote:
              position.investmentReview?.amountCorrection?.note ?? null,
            fundedMinor: position.snapshot.investedMinor,
            acceptedTerms: position.acceptedEconomicsTerms ?? null,
            reportedTerms: position.reportedEconomicsTerms ?? null,
          }
        : null,
    allowFundedAmountEstimate: true,
  }).costBasisMinor;
}

export function createInvestmentExposureView(
  rawPositionView: InvestmentPositionView,
  rawExposures: readonly CanonicalExposure[],
  rawMappings: readonly PositionExposureMapping[],
  rawPrivateCompanyValuations: readonly PrivateCompanyRoundValuation[] = [],
): InvestmentExposureView {
  const positionView = InvestmentPositionViewSchema.parse(rawPositionView);
  const exposures = CanonicalExposureSchema.array().parse(rawExposures);
  const mappings = PositionExposureMappingSchema.array()
    .parse(rawMappings)
    .filter((mapping) => mapping.status === "active");
  const privateCompanyValuations =
    PrivateCompanyRoundValuationSchema.array().parse(
      rawPrivateCompanyValuations,
    );
  const exposureById = new Map<string, CanonicalExposure>();
  for (const exposure of exposures) {
    if (exposureById.has(exposure.id)) {
      throw new Error("Exposure read model received a duplicate exposure.");
    }
    exposureById.set(exposure.id, exposure);
  }

  const positionIds = new Set(
    positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => position.id),
      ),
    ),
  );
  const mappingsByPosition = new Map<string, PositionExposureMapping[]>();
  const activePairs = new Set<string>();
  for (const mapping of mappings) {
    if (!positionIds.has(mapping.positionId)) {
      throw new Error(
        "Exposure mapping is missing its authoritative accepted position.",
      );
    }
    if (!exposureById.has(mapping.exposureId)) {
      throw new Error("Exposure mapping references an unknown exposure.");
    }
    const pair = `${mapping.positionId}:${mapping.exposureId}`;
    if (activePairs.has(pair)) {
      throw new Error(
        "Exposure read model received duplicate active mappings.",
      );
    }
    activePairs.add(pair);
    const current = mappingsByPosition.get(mapping.positionId) ?? [];
    current.push(mapping);
    mappingsByPosition.set(mapping.positionId, current);
  }

  const positionRecords = positionView.connections.flatMap((connection) =>
    connection.containers.flatMap((container) =>
      container.positions.filter(includesCurrentInvestment),
    ),
  );
  const privateCompanyByPositionId = new Map<string, string>();
  for (const position of positionRecords) {
    const positionMappings = mappingsByPosition.get(position.id) ?? [];
    if (positionMappings.length !== 1) {
      continue;
    }
    const mapping = positionMappings[0]!;
    const exposure = exposureById.get(mapping.exposureId);
    if (
      mapping.allocationPpm === PARTS_PER_MILLION &&
      exposure?.exposureKind === "private_company" &&
      exposure.companyId !== null
    ) {
      privateCompanyByPositionId.set(position.id, exposure.companyId);
    }
  }
  const privateValueEstimates = new Map(
    estimatePrivatePositionValues(
      positionRecords.flatMap((position) => {
        const companyId = privateCompanyByPositionId.get(position.id);
        const costBasisMinor = privatePositionCostBasis(position);
        if (
          companyId === undefined ||
          position.openedOn === null ||
          costBasisMinor === null ||
          costBasisMinor <= 0
        ) {
          return [];
        }
        const adjustment = position.acceptedValueAdjustment ?? null;
        const acceptedGpMark =
          adjustment?.sourceKind === "gp_update" ? adjustment : null;
        const providerMark =
          adjustment === null &&
          position.snapshot.unrealizedValue.state === "reported"
            ? position.snapshot.unrealizedValue.minor
            : null;
        const currentValueMinor =
          acceptedGpMark?.valueMinor ?? providerMark ?? null;
        return [
          {
            positionId: position.id,
            companyId,
            openedOn: position.openedOn,
            currency: position.snapshot.currency,
            costBasisMinor,
            currentValueMinor,
            markEffectiveDate:
              acceptedGpMark?.effectiveDate ??
              (providerMark === null
                ? null
                : position.snapshot.observedAt.slice(0, "YYYY-MM-DD".length)),
            markSourceLabel:
              acceptedGpMark?.sourceLabel ??
              (providerMark === null ? null : position.source.label),
            estimateEligible:
              adjustment === null &&
              position.snapshot.providerStatus === "live" &&
              position.snapshot.unrealizedValue.state === "not_reported" &&
              position.snapshot.instrumentType.trim().toLowerCase() !== "cash",
          },
        ];
      }),
      privateCompanyValuations,
    ).map((estimate) => [estimate.positionId, estimate] as const),
  );

  const contributionsByExposure = new Map<
    string,
    InvestmentExposureContribution[]
  >();
  const positions = positionView.connections.flatMap((connection) =>
    connection.containers.flatMap((container) =>
      container.positions.filter(includesCurrentInvestment).map((position) => {
        const positionMappings = mappingsByPosition.get(position.id) ?? [];
        const knownAllocationPpm = positionMappings.reduce(
          (sum, mapping) => sum + (mapping.allocationPpm ?? 0),
          0,
        );
        if (knownAllocationPpm > PARTS_PER_MILLION) {
          throw new Error(
            "Exposure read model allocations exceed one million ppm.",
          );
        }
        const adjustment = position.acceptedValueAdjustment ?? null;
        const privateValueEstimate =
          privateValueEstimates.get(position.id) ?? null;
        const shareValueEstimate =
          position.snapshot.providerStatus === "live"
            ? estimatePurchaseValue(
                position.purchaseReceipt,
                position.snapshot.id,
              )
            : null;
        const useShareEstimate =
          adjustment === null &&
          position.snapshot.unrealizedValue.state === "not_reported" &&
          shareValueEstimate !== null;
        const investedAmountFallback =
          adjustment === null &&
          privateValueEstimate === null &&
          !useShareEstimate &&
          usesInvestedAmountFallback(position);
        const valueState =
          adjustment !== null ||
          useShareEstimate ||
          privateValueEstimate !== null ||
          investedAmountFallback
            ? "reported"
            : position.snapshot.unrealizedValue.state;
        const valueMinor =
          adjustment !== null
            ? adjustment.valueMinor
            : useShareEstimate
              ? shareValueEstimate.valueMinor
              : privateValueEstimate !== null
                ? privateValueEstimate.valueMinor
                : investedAmountFallback
                  ? position.snapshot.investedMinor
                  : position.snapshot.unrealizedValue.minor;
        const allocatedValues: number[] = [];
        const mappingViews = positionMappings.map((mapping) => {
          const allocatedValueMinor =
            valueMinor === null || mapping.allocationPpm === null
              ? null
              : multiplyMinorByScalePpm(valueMinor, mapping.allocationPpm);
          if (allocatedValueMinor !== null) {
            allocatedValues.push(allocatedValueMinor);
          }
          const contribution: InvestmentExposureContribution = {
            mappingId: mapping.id,
            positionId: position.id,
            exposureId: mapping.exposureId,
            relationshipKind: mapping.relationshipKind,
            currency: position.snapshot.currency,
            valueState,
            positionValueMinor: valueMinor,
            allocationPpm: mapping.allocationPpm,
            allocatedValueMinor,
            decisionSource: mapping.decisionSource,
            decisionReference: mapping.decisionReference,
            evidenceSha256: mapping.evidenceSha256,
            effectiveAt: mapping.effectiveAt,
            version: mapping.version,
          };
          const contributions =
            contributionsByExposure.get(mapping.exposureId) ?? [];
          contributions.push(contribution);
          contributionsByExposure.set(mapping.exposureId, contributions);
          return {
            id: mapping.id,
            exposureId: mapping.exposureId,
            relationshipKind: mapping.relationshipKind,
            allocationPpm: mapping.allocationPpm,
            decisionSource: mapping.decisionSource,
            decisionReference: mapping.decisionReference,
            evidenceSha256: mapping.evidenceSha256,
            effectiveAt: mapping.effectiveAt,
            version: mapping.version,
          };
        });
        const allocatedValueMinor =
          valueMinor === null ? null : safeMinorSum(allocatedValues);
        const unallocatedValueMinor =
          valueMinor === null || allocatedValueMinor === null
            ? null
            : NonNegativeMoneyMinorSchema.parse(
                valueMinor - allocatedValueMinor,
              );
        return {
          id: position.id,
          connectionId: connection.id,
          adapterType: connection.adapterType,
          institutionKey: connection.institutionKey,
          institutionLabel: connection.institutionLabel,
          connectionState: connection.lifecycleState,
          containerId: container.id,
          containerLabel: container.label,
          containerKind: container.kind,
          taxTreatment: container.taxTreatment,
          coverage: container.coverage,
          legalVehicleName: position.legalVehicleName,
          openedOn: position.openedOn,
          reportedExposureName: position.reportedExposureName,
          positionKind: position.kind,
          ownershipBasis: position.ownershipBasis,
          sourceLabel: position.source.label,
          sourceFreshness: position.source.freshness,
          snapshotId: position.snapshot.id,
          snapshotFingerprint: position.snapshot.fingerprint,
          observedAt: position.snapshot.observedAt,
          instrumentType: position.snapshot.instrumentType,
          currency: position.snapshot.currency,
          ticker: position.snapshot.ticker,
          quantityMicros: position.snapshot.quantityMicros,
          investedMinor: position.snapshot.investedMinor,
          committedMinor: investmentAmount(position),
          realizedValueMinor: position.snapshot.realizedValueMinor,
          providerCostBasisMinor: position.snapshot.costBasisMinor,
          acceptedEconomicsTerms: position.acceptedEconomicsTerms ?? null,
          reportedEconomicsTerms: position.reportedEconomicsTerms ?? null,
          valueSource:
            adjustment !== null
              ? "reviewed_adjustment"
              : useShareEstimate
                ? "share_price_estimate"
                : privateValueEstimate !== null
                  ? "portfolio_watch_estimate"
                  : investedAmountFallback
                    ? "invested_amount"
                    : "provider",
          valueEffectiveDate:
            adjustment?.effectiveDate ??
            (useShareEstimate
              ? shareValueEstimate.effectiveDate
              : (privateValueEstimate?.effectiveDate ??
                position.snapshot.observedAt.slice(0, "YYYY-MM-DD".length))),
          valueSourceLabel:
            adjustment?.sourceLabel ??
            (useShareEstimate
              ? shareValueEstimate.proxy
                ? "Proxy share price estimate"
                : "Reviewed underlying share prices"
              : null) ??
            (privateValueEstimate === null
              ? position.source.label
              : `Portfolio Watch + ${privateValueEstimate.referenceSourceLabel}`),
          priorValueState: position.priorValue?.state ?? null,
          priorValueMinor: position.priorValue?.minor ?? null,
          priorValueObservedAt: position.priorValue?.observedAt ?? null,
          isPrivateCompanyPosition: privateCompanyByPositionId.has(position.id),
          privateValueEstimate,
          shareValueEstimate,
          valueState,
          valueMinor,
          mappings: mappingViews,
          mappedExposureIds: mappingViews.map((mapping) => mapping.exposureId),
          knownAllocationPpm,
          hasUnknownAllocation: positionMappings.some(
            (mapping) => mapping.allocationPpm === null,
          ),
          allocatedValueMinor,
          unallocatedValueMinor,
        };
      }),
    ),
  );

  return InvestmentExposureViewSchema.parse({
    asOf: positionView.asOf,
    positions,
    exposures: exposures
      .filter((exposure) => contributionsByExposure.has(exposure.id))
      .map((exposure) => {
        const contributions = contributionsByExposure.get(exposure.id) ?? [];
        const totalsByCurrency = new Map<
          string,
          {
            allocatedValues: number[];
            knownValuePositionCount: number;
            unknownValuePositionCount: number;
          }
        >();
        for (const contribution of contributions) {
          const total = totalsByCurrency.get(contribution.currency) ?? {
            allocatedValues: [],
            knownValuePositionCount: 0,
            unknownValuePositionCount: 0,
          };
          if (contribution.allocatedValueMinor === null) {
            total.unknownValuePositionCount += 1;
          } else {
            total.allocatedValues.push(contribution.allocatedValueMinor);
            total.knownValuePositionCount += 1;
          }
          totalsByCurrency.set(contribution.currency, total);
        }
        return {
          exposure,
          contributions,
          totals: [...totalsByCurrency.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currency, total]) => ({
              currency,
              allocatedValueMinor: safeMinorSum(total.allocatedValues),
              knownValuePositionCount: total.knownValuePositionCount,
              unknownValuePositionCount: total.unknownValuePositionCount,
            })),
        };
      }),
  });
}
