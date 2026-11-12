import { z } from "zod";

export const AppPermissionsSchema = z.strictObject({
  goals: z.enum(["none", "read", "manage"]),
  holdings: z.enum(["none", "read"]),
  cash: z.enum(["none", "read"]),
  evidence: z.enum(["none", "read"]),
});
export type AppPermissions = z.infer<typeof AppPermissionsSchema>;
export const appScopeNames = [
  "goals:read",
  "goals:write",
  "holdings:read",
  "cash:read",
  "evidence:read",
] as const;
export const AppScopeSchema = z.enum(appScopeNames);
export type AppScope = z.infer<typeof AppScopeSchema>;
export const AppScopesSchema = z
  .array(AppScopeSchema)
  .min(1)
  .max(5)
  .refine(
    (scopes) =>
      new Set(scopes).size === scopes.length &&
      (!scopes.includes("goals:write") || scopes.includes("goals:read")),
    "Use unique scopes; managing goals also requires reading them.",
  );
export function permissionScopes(p: AppPermissions): AppScope[] {
  const result: AppScope[] = [];
  if (p.goals !== "none") result.push("goals:read");
  if (p.goals === "manage") result.push("goals:write");
  if (p.holdings === "read") result.push("holdings:read");
  if (p.cash === "read") result.push("cash:read");
  if (p.evidence === "read") result.push("evidence:read");
  return result;
}
export function scopePermissions(scopes: readonly string[]): AppPermissions {
  return {
    goals: scopes.includes("goals:write")
      ? "manage"
      : scopes.includes("goals:read")
        ? "read"
        : "none",
    holdings: scopes.includes("holdings:read") ? "read" : "none",
    cash: scopes.includes("cash:read") ? "read" : "none",
    evidence: scopes.includes("evidence:read") ? "read" : "none",
  };
}
export const KeyInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(64),
    permissions: AppPermissionsSchema,
    durationDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
    rotation: z.enum(["manual", "agent"]),
  })
  .refine(
    (v) => permissionScopes(v.permissions).length > 0,
    "Choose at least one area.",
  );
export const AppGrantSchema = z.strictObject({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  name: z.string().min(1).max(256),
  kind: z.enum(["key", "oauth"]),
  permissions: AppPermissionsSchema,
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  rotation: z.enum(["manual", "agent"]),
  suffix: z.string().nullable(),
  previousKeyExpiresAt: z.string().nullable(),
  clientOrigin: z.string().nullable(),
});
export type AppGrant = z.infer<typeof AppGrantSchema>;
export const AppAccessStateSchema = z.strictObject({
  apiOrigin: z.url(),
  mcpUrl: z.url(),
  openApiUrl: z.url(),
  evaluatedAt: z.string(),
  grants: z.array(AppGrantSchema).max(50),
  nextAfter: z.string().nullable(),
});
export const KeyReceiptSchema = z.strictObject({
  key: z.string().min(32),
  grant: AppGrantSchema,
});
export const AuthorizationRequestSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(256),
  redirect_uri: z.url().max(2048),
  state: z.string().min(1).max(1024).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.url().max(2048),
  scope: z
    .string()
    .min(1)
    .max(256)
    .default("goals:read holdings:read cash:read evidence:read"),
});
export const AuthorizationContextSchema = z.strictObject({
  name: z.string(),
  clientOrigin: z.url(),
  permissions: AppPermissionsSchema,
  requestedPermissions: AppPermissionsSchema,
  request: AuthorizationRequestSchema,
});
export const AuthorizationDecisionSchema = z
  .strictObject({
    request: AuthorizationRequestSchema,
    permissions: AppPermissionsSchema,
    durationDays: z.union([z.literal(90), z.literal(365), z.null()]),
  })
  .refine(
    (v) => permissionScopes(v.permissions).length > 0,
    "Choose at least one area.",
  );
export const AuthorizationReceiptSchema = z.strictObject({
  redirectUrl: z.url(),
});

export function ownerOperationScopes(
  method: string,
  path: string,
): readonly AppScope[] | null {
  if (method === "POST" && path === "/api/v1/key/rotate") return [];
  if (method === "GET" && path === "/api/v1/openapi.json") return [];
  if (
    (method === "GET" && path === "/api/v1/outlook") ||
    (method === "POST" && path === "/api/v1/outlook/preview") ||
    (method === "GET" && /^\/api\/v1\/baselines\/[^/]+$/.test(path))
  )
    return ["goals:read", "holdings:read", "cash:read", "evidence:read"];
  if (method === "GET" && path === "/api/v1/marks")
    return ["holdings:read", "evidence:read"];
  if (/^\/api\/v1\/goals(?:\/[^/]+(?:\/versions)?)?$/.test(path)) {
    if (method === "GET") return ["goals:read"];
    if (
      (method === "POST" && path === "/api/v1/goals") ||
      (method === "PATCH" && /^\/api\/v1\/goals\/[^/]+$/.test(path))
    )
      return ["goals:read", "goals:write"];
  }
  if (method === "GET" && /^\/api\/v1\/positions(?:\/[^/]+)?$/.test(path))
    return ["holdings:read"];
  if (
    method === "GET" &&
    /^\/api\/v1\/(?:accounts|liabilities)(?:\/[^/]+)?$/.test(path)
  )
    return ["cash:read"];
  if (method === "GET" && /^\/api\/v1\/evidence\/[^/]+$/.test(path))
    return ["evidence:read"];
  return null;
}
