import { crc32, deflateSync } from "node:zlib";

// A small stored ZIP isolates MaxFiles from PDF parsing's time budget. Its
// complete payload and expanded contents both stay below 8 MiB at 10001 items.
export function syntheticManyFileZip(
  fileCount: number,
): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(fileCount) || fileCount < 1 || fileCount > 11_000)
    throw new Error("Synthetic file count must be between 1 and 11000.");
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < fileCount; index += 1) {
    const name = Buffer.from(`synthetic-${index.toString()}.txt`);
    const content = Buffer.from(
      `Synthetic scanner budget item ${index.toString()}\n`,
    );
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(content), 14);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, name, content);
    directory.push(entry, name);
    offset += header.length + name.length + content.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(fileCount, 8);
  end.writeUInt16LE(fileCount, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, central, end]));
}

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
