import { deflateSync } from "node:zlib";

// Fully synthetic, valid PDF structure with many independently compressed
// streams. Distinct contents prevent the scanner's clean-file cache from
// hiding work. No source document or document-specific exception is needed.
export function syntheticManyStreamPdf(
  streamCount: number,
  lastStream?: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (
    !Number.isSafeInteger(streamCount) ||
    streamCount < 1 ||
    streamCount > 11_000
  )
    throw new Error("Synthetic stream count must be between 1 and 11000.");
  const streams = Array.from({ length: streamCount }, (_, index) => {
    const text =
      index === 0
        ? "BT /F1 12 Tf 50 750 Td (Issuer: Synthetic Atlas SPV LLC) Tj ET"
        : `q\n% Synthetic content stream ${index.toString()}\nQ`;
    const compressed = deflateSync(
      index === streamCount - 1 && lastStream ? lastStream : Buffer.from(text),
    );
    return Buffer.concat([
      Buffer.from(
        `<< /Length ${compressed.length.toString()} /Filter /FlateDecode >>\nstream\n`,
      ),
      compressed,
      Buffer.from("\nendstream"),
    ]);
  });
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents [${streams.map((_, index) => `${(index + 5).toString()} 0 R`).join(" ")}] >>`,
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    ...streams,
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${(index + 1).toString()} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    length += chunk.length;
  }
  const count = (objects.length + 1).toString();
  chunks.push(
    Buffer.from(
      `xref\n0 ${count}\n0000000000 65535 f \n${offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${length.toString()}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(chunks));
}
