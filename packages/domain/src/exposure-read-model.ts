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
  type InvestmentPositionView,
} from "./position-read-model";

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

function safeMinorSum(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  return NonNegativeMoneyMinorSchema.parse(Number(total));
}

export function createInvestmentExposureView(
  rawPositionView: InvestmentPositionView,
  rawExposures: readonly CanonicalExposure[],
  rawMappings: readonly PositionExposureMapping[],
): InvestmentExposureView {
  const positionView = InvestmentPositionViewSchema.parse(rawPositionView);
  const exposures = CanonicalExposureSchema.array().parse(rawExposures);
  const mappings = PositionExposureMappingSchema.array()
    .parse(rawMappings)
    .filter((mapping) => mapping.status === "active");
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

  const contributionsByExposure = new Map<
    string,
    InvestmentExposureContribution[]
  >();
  const positions = positionView.connections.flatMap((connection) =>
    connection.containers.flatMap((container) =>
      container.positions.map((position) => {
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
        const valueState = position.snapshot.unrealizedValue.state;
        const valueMinor = position.snapshot.unrealizedValue.minor;
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
    exposures: exposures.map((exposure) => {
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
