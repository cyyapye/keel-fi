import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleSheet,
  googleSheetsCreateBody,
  GoogleSheetsCreationUncertainError,
} from "./google-sheets-export";

const table = {
  title: "Synthetic legal entities",
  columns: ["Legal name", "EIN last four", "Current value"],
  rows: [
    ['=IMPORTXML("https://example.com","*")', "0007", "USD 90071992547409.91"],
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("Google Sheets export", () => {
  it("sends a complete 120-row sheet in one request with literal strings and no sharing change", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ spreadsheetId: "synthetic_sheet_123" }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      createGoogleSheet(
        { ...table, rows: Array.from({ length: 120 }, () => table.rows[0]!) },
        "synthetic-oauth-token",
      ),
    ).resolves.toBe(
      "https://docs.google.com/spreadsheets/d/synthetic_sheet_123/edit",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://sheets.googleapis.com/v4/spreadsheets");
    expect(request).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer synthetic-oauth-token" },
    });
    const body = JSON.parse(request.body);
    expect(body.sheets).toHaveLength(1);
    expect(body.sheets[0].properties.gridProperties).toEqual({
      rowCount: 121,
      columnCount: 3,
      frozenRowCount: 1,
    });
    expect(body.sheets[0].data[0].rowData).toHaveLength(121);
    expect(body.sheets[0].data[0].rowData[1].values).toMatchObject(
      table.rows[0]!.map((value) => ({
        userEnteredValue: { stringValue: value },
      })),
    );
    expect(body).not.toHaveProperty("permissions");
  });

  it.each([
    { rows: [["a", "b"]] },
    { rows: Array.from({ length: 10_001 }, () => ["a", "b", "c"]) },
    { rows: [["a".repeat(50_001), "b", "c"]] },
    { rows: Array.from({ length: 50 }, () => ["a".repeat(49_000), "b", "c"]) },
  ])(
    "rejects malformed or oversized exports before sending data",
    async (overrides) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      await expect(
        createGoogleSheet({ ...table, ...overrides }, "synthetic-oauth-token"),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("supports an empty inventory with the selected header", () => {
    const body = JSON.parse(googleSheetsCreateBody({ ...table, rows: [] }));
    expect(body.sheets[0].properties.gridProperties.rowCount).toBe(2);
    expect(body.sheets[0].data[0].rowData).toHaveLength(1);
  });

  it.each(["network", "server", "invalid response"])(
    "does not retry an uncertain create after %s failure",
    async (failure) => {
      const fetcher = vi.fn();
      if (failure === "network")
        fetcher.mockRejectedValue(new TypeError("network failed"));
      else
        fetcher.mockResolvedValue(
          failure === "server"
            ? new Response(null, { status: 503 })
            : Response.json({ spreadsheetId: "https://example.com/untrusted" }),
        );
      vi.stubGlobal("fetch", fetcher);
      await expect(
        createGoogleSheet(table, "synthetic-oauth-token"),
      ).rejects.toBeInstanceOf(GoogleSheetsCreationUncertainError);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403, 429])(
    "keeps a Google %s denial distinct from an uncertain write",
    async (status) => {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
      vi.stubGlobal("fetch", fetcher);
      await expect(
        createGoogleSheet(table, "synthetic-oauth-token"),
      ).rejects.toThrow(
        status === 429 ? "Google is busy" : "Google did not allow",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
