const MAX_ANGELLIST_CSV_BYTES = 1_048_576;
export const MAX_ANGELLIST_MULTIPART_BYTES =
  MAX_ANGELLIST_CSV_BYTES + 64 * 1024;

const acceptedCsvTypes = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

export class HoldingImportUploadError extends Error {
  public constructor(
    public readonly code: "invalid_request" | "invalid_file" | "file_too_large",
    message: string,
  ) {
    super(message);
    this.name = "HoldingImportUploadError";
  }
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function angelListExportDate(
  fileName: string,
  retrievedAt: string,
): string {
  const match = /(?:^|_)(\d{4})_(\d{2})_(\d{2})\.csv$/i.exec(fileName);
  const candidate = match === null ? "" : `${match[1]}-${match[2]}-${match[3]}`;
  return validIsoDate(candidate) ? candidate : retrievedAt.slice(0, 10);
}

async function boundedMultipartRequest(request: Request): Promise<Request> {
  if (request.body === null) {
    throw new HoldingImportUploadError(
      "invalid_request",
      "Choose an AngelList CSV export.",
    );
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    byteSize += chunk.value.byteLength;
    if (byteSize > MAX_ANGELLIST_MULTIPART_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HoldingImportUploadError(
        "file_too_large",
        "The CSV must be 1 MB or smaller.",
      );
    }
    chunks.push(chunk.value);
  }

  const body = new ArrayBuffer(byteSize);
  const view = new Uint8Array(body);
  let offset = 0;
  chunks.forEach((chunk) => {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new Request(request, { body });
}

export async function readAngelListCsvUpload(request: Request): Promise<{
  bytes: Uint8Array;
  effectiveDate: string;
  retrievedAt: string;
}> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new HoldingImportUploadError(
      "invalid_request",
      "Choose an AngelList CSV export.",
    );
  }

  const contentLength = request.headers.get("Content-Length");
  if (
    contentLength !== null &&
    (/^\d+$/.test(contentLength) === false ||
      Number(contentLength) > MAX_ANGELLIST_MULTIPART_BYTES)
  ) {
    throw new HoldingImportUploadError(
      "file_too_large",
      "The CSV must be 1 MB or smaller.",
    );
  }

  let formData: FormData;
  try {
    formData = await (await boundedMultipartRequest(request)).formData();
  } catch (error) {
    if (error instanceof HoldingImportUploadError) {
      throw error;
    }
    throw new HoldingImportUploadError(
      "invalid_request",
      "Keel could not read that CSV upload.",
    );
  }

  const entries = [...formData.entries()];
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    entry === undefined ||
    entry[0] !== "file" ||
    typeof entry[1] === "string"
  ) {
    throw new HoldingImportUploadError(
      "invalid_request",
      "Choose exactly one AngelList CSV export.",
    );
  }

  const file = entry[1];
  const normalizedType = file.type.toLowerCase().split(";", 1)[0] ?? "";
  if (
    !file.name.toLowerCase().endsWith(".csv") ||
    !acceptedCsvTypes.has(normalizedType)
  ) {
    throw new HoldingImportUploadError(
      "invalid_file",
      "Choose the .csv file exported by AngelList.",
    );
  }
  if (file.size === 0) {
    throw new HoldingImportUploadError(
      "invalid_file",
      "The AngelList CSV is empty.",
    );
  }
  if (file.size > MAX_ANGELLIST_CSV_BYTES) {
    throw new HoldingImportUploadError(
      "file_too_large",
      "The CSV must be 1 MB or smaller.",
    );
  }

  const retrievedAt = new Date().toISOString();
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    effectiveDate: angelListExportDate(file.name, retrievedAt),
    retrievedAt,
  };
}
