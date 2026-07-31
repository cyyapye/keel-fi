import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import type { AccessIdentity, Env } from "./types";

const AccessConfigurationSchema = z.object({
  ACCESS_AUD: z.string().min(8),
  ACCESS_TEAM_DOMAIN: z
    .string()
    .min(3)
    .transform((value) =>
      value.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    ),
});

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type AccessVerifier = (
  token: string,
  env: Env,
) => Promise<AccessIdentity>;

export const verifyAccessToken: AccessVerifier = async (token, env) => {
  const configuration = AccessConfigurationSchema.parse(env);
  const issuer = `https://${configuration.ACCESS_TEAM_DOMAIN}`;
  const certsUrl = `${issuer}/cdn-cgi/access/certs`;
  let keySet = keySets.get(certsUrl);

  if (keySet === undefined) {
    keySet = createRemoteJWKSet(new URL(certsUrl));
    keySets.set(certsUrl, keySet);
  }

  const { payload } = await jwtVerify(token, keySet, {
    algorithms: ["RS256"],
    audience: configuration.ACCESS_AUD,
    issuer,
  });

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Cloudflare Access identity is missing a subject.");
  }

  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
  };
};
