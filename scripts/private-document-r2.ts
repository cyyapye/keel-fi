import { AwsClient } from "aws4fetch";
import { z } from "zod";

export const PrivateR2ConfigSchema = z
  .object({
    account: z.string().regex(/^[a-f0-9]{32}$/u),
    bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u),
    accessKeyId: z.string().min(16).max(128),
    secretAccessKey: z.string().min(32).max(128),
  })
  .strict();

// Bucket-scoped object permissions are available on S3, not Cloudflare REST.
// Never generate a presigned/public URL or accept a caller-supplied endpoint.
export function privateR2(raw: z.infer<typeof PrivateR2ConfigSchema>) {
  const config = PrivateR2ConfigSchema.parse(raw);
  const client = new AwsClient({
    ...config,
    service: "s3",
    region: "auto",
    retries: 0,
  });
  return async (key: string, init: RequestInit = {}) => {
    if (
      key.length === 0 ||
      key.length > 1024 ||
      key.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error("Invalid private object key");
    const url = `https://${config.account}.r2.cloudflarestorage.com/${config.bucket}/${key
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
    return client.fetch(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  };
}
