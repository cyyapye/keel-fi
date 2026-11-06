import { open } from "node:fs/promises";
import { z } from "zod";
import { readMaintenanceJson } from "./d1-maintenance-http";

const ExportResponse = z.object({
  success: z.literal(true),
  result: z.object({
    success: z.literal(true),
    status: z.enum(["complete", "error"]).optional(),
    at_bookmark: z.string().min(1).max(1024).optional(),
    result: z.object({ signed_url: z.url() }).optional(),
  }),
});
const ExportInput = z.object({
  account: z.string().regex(/^[a-f0-9]{32}$/u),
  database: z.uuid(),
  token: z.string().min(20),
  output: z.string().min(1),
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 ** 2),
});

export const D1_EXPORT_MAX_POLLS = 12;

export async function exportMaintenanceD1(
  raw: z.input<typeof ExportInput>,
  dependencies: {
    fetch?: typeof fetch;
    delay?: (ms: number) => Promise<void>;
    check?: () => void;
  } = {},
) {
  const input = ExportInput.parse(raw);
  const fetchImplementation = dependencies.fetch ?? fetch;
  const delay =
    dependencies.delay ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let bookmark: string | undefined;
  for (let attempt = 0; attempt < D1_EXPORT_MAX_POLLS; attempt++) {
    dependencies.check?.();
    const response = await fetchImplementation(
      `https://api.cloudflare.com/client/v4/accounts/${input.account}/d1/database/${input.database}/export`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          output_format: "polling",
          dump_options: { no_schema: false, no_data: false, tables: [] },
          ...(bookmark === undefined ? {} : { current_bookmark: bookmark }),
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    ).catch(() => {
      throw new Error(
        "D1 export outcome is unknown; do not replay automatically.",
      );
    });
    if (!response.ok)
      throw new Error("D1 export failed; capacity remains charged.");
    const parsed = ExportResponse.safeParse(
      await readMaintenanceJson(response),
    );
    if (!parsed.success || parsed.data.result.status === "error")
      throw new Error("D1 export returned invalid or failed evidence.");
    const result = parsed.data.result;
    if (result.status === "complete") {
      if (!result.result) throw new Error("D1 export download is unavailable.");
      const url = new URL(result.result.signed_url);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        !url.hostname.endsWith(".r2.cloudflarestorage.com")
      )
        throw new Error("D1 export returned an unexpected download host.");
      dependencies.check?.();
      const download = await fetchImplementation(url, {
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      }).catch(() => {
        throw new Error("D1 export download failed.");
      });
      if (!download.ok || download.body === null)
        throw new Error("D1 export download is unavailable.");
      const file = await open(input.output, "wx", 0o600);
      const reader = download.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > input.maxBytes)
            throw new Error("D1 export exceeds the certified size envelope.");
          await file.writeFile(part.value);
        }
        if (bytes === 0) throw new Error("D1 export is empty.");
      } finally {
        await reader.cancel().catch(() => undefined);
        await file.close();
      }
      return {
        polls: attempt + 1,
        bytes,
        actualBilledRows: "unavailable" as const,
      };
    }
    if (!result.at_bookmark)
      throw new Error("D1 export continuation is unavailable.");
    if (bookmark !== undefined && bookmark !== result.at_bookmark)
      throw new Error("D1 export bookmark changed unexpectedly.");
    bookmark = result.at_bookmark;
    if (attempt + 1 < D1_EXPORT_MAX_POLLS) await delay(1_000);
  }
  throw new Error("D1 export polling limit reached; capacity remains charged.");
}
