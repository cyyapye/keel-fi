import { z } from "zod";

const Base64UrlKeySchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .refine((value) => {
    try {
      return base64UrlDecode(value).byteLength === 32;
    } catch {
      return false;
    }
  }, "Expected a 32-byte base64url key.");

const ProtectedProviderKeyInputSchema = z
  .object({
    credentialKey: Base64UrlKeySchema,
    salt: z.string().min(1).max(128),
    info: z.string().min(1).max(128),
    value: z.string().min(1).max(2_048),
  })
  .strict();

export const ProtectedProviderKeySchema = z.string().regex(/^[a-f0-9]{64}$/u);

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64UrlDecode(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Derive a one-way provider identifier with explicit domain separation.
 * Callers keep raw identifiers in restricted source material and persist only
 * the returned lowercase SHA-256 HMAC.
 */
export async function deriveProtectedProviderKey(rawInput: {
  credentialKey: string | undefined;
  salt: string;
  info: string;
  value: string;
}): Promise<string> {
  const input = ProtectedProviderKeyInputSchema.parse(rawInput);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(base64UrlDecode(input.credentialKey)),
    "HKDF",
    false,
    ["deriveKey"],
  );
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ownedArrayBuffer(new TextEncoder().encode(input.salt)),
      info: ownedArrayBuffer(new TextEncoder().encode(input.info)),
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    ownedArrayBuffer(new TextEncoder().encode(input.value)),
  );
  return ProtectedProviderKeySchema.parse(
    [...new Uint8Array(signature)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
}
