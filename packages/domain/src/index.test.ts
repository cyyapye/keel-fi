import { describe, expect, it } from "vitest";

import {
  multiplyMinorByPpm,
  probabilityMeetingThresholdPpm,
  summarizeLiquidityPaths,
} from "./index";

describe("deterministic financial calculations", () => {
  it("multiplies money by integer parts per million without floating point", () => {
    expect(multiplyMinorByPpm(12_345, 333_333)).toBe(4_115);
    expect(multiplyMinorByPpm(10_001, 500_000)).toBe(5_001);
  });

  it("summarizes annual cumulative liquidity paths", () => {
    const summary = summarizeLiquidityPaths(
      [2027, 2028],
      [
        [0, 100_00],
        [0, 200_00],
        [100_00, 400_00],
        [300_00, 800_00],
      ],
    );

    expect(summary[0]).toEqual({
      year: 2027,
      p25Minor: 0,
      p50Minor: 0,
      p75Minor: 100_00,
      expectedMinor: 100_00,
      probabilityZeroPpm: 500_000,
    });
    expect(summary[1]?.p50Minor).toBe(200_00);
  });

  it("computes threshold probability as integer ppm", () => {
    expect(
      probabilityMeetingThresholdPpm(
        [1_000_00, 2_000_00, 3_000_00, 4_000_00],
        3_000_00,
      ),
    ).toBe(500_000);
  });
});
