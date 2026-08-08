import { describe, expect, it } from "vitest";

import {
  angelListExportDate,
  MAX_ANGELLIST_MULTIPART_BYTES,
  readAngelListCsvUpload,
} from "./holding-import-upload";

function uploadRequest(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("https://keel.example/api/holding-imports/angellist", {
    method: "POST",
    body: formData,
  });
}

describe("AngelList holding import uploads", () => {
  it("derives an export date only from a valid dated CSV name", () => {
    expect(
      angelListExportDate(
        "synthetic_angellist_investments_2026_06_14.csv",
        "2026-08-09T12:00:00.000Z",
      ),
    ).toBe("2026-06-14");
    expect(
      angelListExportDate(
        "synthetic_angellist_investments_2026_02_31.csv",
        "2026-08-09T12:00:00.000Z",
      ),
    ).toBe("2026-08-09");
  });

  it("accepts exactly one bounded synthetic CSV file", async () => {
    const result = await readAngelListCsvUpload(
      uploadRequest(
        new File(["synthetic,csv\n"], "synthetic_2026_06_14.csv", {
          type: "text/csv",
        }),
      ),
    );

    expect(new TextDecoder().decode(result.bytes)).toBe("synthetic,csv\n");
    expect(result.effectiveDate).toBe("2026-06-14");
  });

  it("rejects a non-CSV file without reflecting its contents", async () => {
    await expect(
      readAngelListCsvUpload(
        uploadRequest(
          new File(["fabricated private text"], "synthetic.txt", {
            type: "text/plain",
          }),
        ),
      ),
    ).rejects.toMatchObject({
      code: "invalid_file",
      message: "Choose the .csv file exported by AngelList.",
    });
  });

  it("caps the multipart stream even without a Content-Length header", async () => {
    const request = new Request(
      "https://keel.example/api/holding-imports/angellist",
      {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=synthetic" },
        body: new ArrayBuffer(MAX_ANGELLIST_MULTIPART_BYTES + 1),
      },
    );
    expect(request.headers.has("Content-Length")).toBe(false);

    await expect(readAngelListCsvUpload(request)).rejects.toMatchObject({
      code: "file_too_large",
      message: "The CSV must be 1 MB or smaller.",
    });
  });
});
