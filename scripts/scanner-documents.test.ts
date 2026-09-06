import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  syntheticManyFileZip,
  syntheticManyStreamPdf,
} from "./test-support/scanner-documents";

describe("synthetic scanner budget PDFs", () => {
  it("contains distinct compressed streams and valid byte-based object offsets", () => {
    const bytes = Buffer.from(syntheticManyStreamPdf(512));
    const pdf = bytes.toString("latin1");
    const streams = [
      ...pdf.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/gu),
    ];
    expect(streams).toHaveLength(512);
    const expanded = streams.map((match) => {
      const offset = match.index + match[0].length;
      return inflateSync(
        bytes.subarray(offset, offset + Number(match[1])),
      ).toString();
    });
    expect(new Set(expanded).size).toBe(512);
    expect(expanded[0]).toContain("Issuer: Synthetic Atlas SPV LLC");
    expect(expanded.at(-1)).toContain("Synthetic content stream 511");
    const xref = Number(/startxref\n(\d+)/u.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 5)).toBe("xref\n");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n /gmu)];
    expect(offsets).toHaveLength(516);
    offsets.forEach((match, index) => {
      expect(pdf.slice(Number(match[1]))).toMatch(
        new RegExp(`^${(index + 1).toString()} 0 obj\\n`, "u"),
      );
    });
  });
  it("keeps a late test marker compressed rather than visible in the outer PDF", () => {
    const marker = Buffer.from("SYNTHETIC-LATE-STREAM-MARKER");
    const bytes = Buffer.from(syntheticManyStreamPdf(512, marker));
    expect(bytes.includes(marker)).toBe(false);
    const pdf = bytes.toString("latin1");
    const match = [
      ...pdf.matchAll(/\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/gu),
    ].at(-1)!;
    const offset = match.index + match[0].length;
    expect(
      inflateSync(bytes.subarray(offset, offset + Number(match[1]))),
    ).toEqual(marker);
  });
  it("crosses the item cap without crossing the input or decoded byte caps", () => {
    const bytes = Buffer.from(syntheticManyFileZip(10_001));
    expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
    const end = bytes.subarray(-22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(8)).toBe(10_001);
    let offset = 0;
    let central = end.readUInt32LE(16);
    let expandedBytes = 0;
    for (let index = 0; index < 10_001; index += 1) {
      expect(bytes.readUInt32LE(offset)).toBe(0x04034b50);
      expect(bytes.readUInt32LE(central)).toBe(0x02014b50);
      expect(bytes.readUInt32LE(central + 42)).toBe(offset);
      const size = bytes.readUInt32LE(offset + 18);
      expect(bytes.readUInt32LE(offset + 22)).toBe(size);
      const nameSize = bytes.readUInt16LE(offset + 26);
      const content = bytes.subarray(
        offset + 30 + nameSize,
        offset + 30 + nameSize + size,
      );
      expect(crc32(content)).toBe(bytes.readUInt32LE(offset + 14));
      expect(content.toString()).toBe(
        `Synthetic scanner budget item ${index.toString()}\n`,
      );
      expandedBytes += size;
      offset += 30 + nameSize + size;
      central += 46 + nameSize;
    }
    expect(offset).toBe(end.readUInt32LE(16));
    expect(central).toBe(bytes.length - 22);
    expect(expandedBytes).toBeLessThan(8 * 1024 * 1024);
  });
  it.each([0, -1, 1.5, 11_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "bounds fixture generation for %s",
    (count) => {
      expect(() => syntheticManyStreamPdf(count)).toThrow(
        "Synthetic stream count",
      );
      expect(() => syntheticManyFileZip(count)).toThrow("Synthetic file count");
    },
  );
});
