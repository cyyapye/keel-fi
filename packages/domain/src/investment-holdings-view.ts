import { z } from "zod";

import { includesCurrentInvestment } from "./investment-review";
import { InvestmentExposureViewSchema } from "./exposure-read-model";
import { InvestmentPositionViewSchema } from "./position-read-model";

export const InvestmentAuthorizationStatusSchema = z.enum([
  "available",
  "provider_approval_required",
  "configuration_required",
]);

export const InvestmentHoldingsViewSchema = z
  .object({
    version: z.literal(1),
    authorizationStatus: InvestmentAuthorizationStatusSchema,
    positionView: InvestmentPositionViewSchema,
    exposureView: InvestmentExposureViewSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.positionView.asOf !== value.exposureView.asOf ||
      value.positionView.asOf.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Investment position and exposure views must share one as-of time.",
        path: ["exposureView", "asOf"],
      });
    }
    const positionSnapshots = value.positionView.connections.flatMap(
      (connection) =>
        connection.containers.flatMap((container) =>
          container.positions
            .filter(includesCurrentInvestment)
            .map((position) => `${position.id}:${position.snapshot.id}`),
        ),
    );
    const exposureSnapshots = value.exposureView.positions.map(
      (position) => `${position.id}:${position.snapshotId}`,
    );
    if (
      positionSnapshots.length !== exposureSnapshots.length ||
      positionSnapshots.some(
        (snapshot) => !exposureSnapshots.includes(snapshot),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Current investment positions and exposure views must use the same accepted snapshots.",
        path: ["exposureView", "positions"],
      });
    }
  });

export type InvestmentAuthorizationStatus = z.infer<
  typeof InvestmentAuthorizationStatusSchema
>;
export type InvestmentHoldingsView = z.infer<
  typeof InvestmentHoldingsViewSchema
>;
