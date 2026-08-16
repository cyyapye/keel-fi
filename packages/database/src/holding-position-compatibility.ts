import { z } from "zod";

export const HoldingPositionReadModeSchema = z.enum([
  "legacy",
  "compatibility",
]);

export type HoldingPositionReadMode = z.infer<
  typeof HoldingPositionReadModeSchema
>;

export type HoldingPositionReadOptions = {
  readonly holdingPositionReadMode?: HoldingPositionReadMode;
};

const CompatibilityReadFlagSchema = z.enum(["true", "false"]).optional();

export function holdingPositionReadModeFromFlag(
  rawFlag: string | undefined,
): HoldingPositionReadMode {
  const flag = CompatibilityReadFlagSchema.parse(rawFlag);
  return flag === "true" ? "compatibility" : "legacy";
}

export function holdingPositionReadSource(
  rawMode: HoldingPositionReadMode | undefined,
): "holding_positions" | "holding_position_compatibility" {
  const mode = HoldingPositionReadModeSchema.parse(rawMode ?? "legacy");
  return mode === "compatibility"
    ? "holding_position_compatibility"
    : "holding_positions";
}
