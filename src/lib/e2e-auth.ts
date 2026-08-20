import { constantTimeEqual } from "./github-oauth";

export const SYNTHETIC_IDENTITIES = {
  "tenant-a": {
    id: 9_007_199_254_740_001,
    login: "soyaos-e2e-tenant-a",
    name: "SoyaOS E2E Tenant A",
    avatarUrl: null,
  },
  "tenant-b": {
    id: 9_007_199_254_740_002,
    login: "soyaos-e2e-tenant-b",
    name: "SoyaOS E2E Tenant B",
    avatarUrl: null,
  },
} as const;

export type SyntheticIdentity = keyof typeof SYNTHETIC_IDENTITIES;
export type E2EAccess = "authorized" | "disabled" | "unauthorized";

export function e2eAccess(request: Request, env: PortalEnv): E2EAccess {
  if (env.DEPLOYMENT_ENV !== "staging") return "disabled";
  const expected = env.E2E_BOOTSTRAP_SECRET?.trim() ?? "";
  if (new TextEncoder().encode(expected).length < 32) return "disabled";
  const authorization = request.headers.get("authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(provided, expected) ? "authorized" : "unauthorized";
}

export function isSyntheticIdentity(value: unknown): value is SyntheticIdentity {
  return value === "tenant-a" || value === "tenant-b";
}
