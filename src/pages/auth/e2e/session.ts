import type { APIRoute } from "astro";
import { constantTimeEqual } from "../../../lib/github-oauth";
import { runtimeEnv } from "../../../lib/runtime-env";
import { createSession, setSession } from "../../../lib/session";

export const prerender = false;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

const SYNTHETIC_IDENTITIES = {
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

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const env = runtimeEnv();
  if (env.DEPLOYMENT_ENV !== "staging") {
    return json({ error: { code: "not_found", message: "Not found." } }, 404);
  }

  const expectedSecret = env.E2E_BOOTSTRAP_SECRET?.trim() ?? "";
  if (new TextEncoder().encode(expectedSecret).length < 32) {
    return json({ error: { code: "not_found", message: "Not found." } }, 404);
  }
  if (!constantTimeEqual(bearerToken(request), expectedSecret)) {
    return json({ error: { code: "unauthorized", message: "Authentication required." } }, 401);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return json(
      { error: { code: "unsupported_media_type", message: "Expected application/json." } },
      415,
    );
  }

  let identity: unknown;
  try {
    const body: unknown = await request.json();
    identity =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { identity?: unknown }).identity
        : null;
  } catch {
    return json({ error: { code: "invalid_request", message: "Invalid JSON body." } }, 400);
  }

  if (identity !== "tenant-a" && identity !== "tenant-b") {
    return json(
      { error: { code: "invalid_request", message: "Unknown synthetic identity." } },
      400,
    );
  }

  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  try {
    const user = SYNTHETIC_IDENTITIES[identity];
    await setSession(cookies, createSession(user), sessionSecret);
    return json({ identity, login: user.login }, 200);
  } catch {
    return json(
      { error: { code: "temporarily_unavailable", message: "Session service unavailable." } },
      503,
    );
  }
};
