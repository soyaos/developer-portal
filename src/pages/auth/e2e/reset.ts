import type { APIRoute } from "astro";
import {
  e2eAccess,
  isSyntheticIdentity,
  SYNTHETIC_IDENTITIES,
} from "../../../lib/e2e-auth";
import {
  expireSyntheticTenantMetadata,
  resetSyntheticTenant,
} from "../../../lib/control-plane";
import { runtimeEnv } from "../../../lib/runtime-env";

export const prerender = false;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export const POST: APIRoute = async ({ request }) => {
  const env = runtimeEnv();
  const access = e2eAccess(request, env);
  if (access === "disabled") {
    return json({ error: { code: "not_found", message: "Not found." } }, 404);
  }
  if (access === "unauthorized") {
    return json({ error: { code: "unauthorized", message: "Authentication required." } }, 401);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json(
      { error: { code: "unsupported_media_type", message: "Expected application/json." } },
      415,
    );
  }

  let identity: unknown;
  let mode: unknown;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      identity = (body as { identity?: unknown }).identity;
      mode = (body as { mode?: unknown }).mode ?? "reset";
    }
  } catch {
    return json({ error: { code: "invalid_request", message: "Invalid JSON body." } }, 400);
  }
  if (!isSyntheticIdentity(identity) || (mode !== "reset" && mode !== "expire")) {
    return json(
      { error: { code: "invalid_request", message: "Unknown maintenance request." } },
      400,
    );
  }
  if (!env.DB) {
    return json(
      { error: { code: "temporarily_unavailable", message: "Storage unavailable." } },
      503,
    );
  }

  try {
    const githubId = SYNTHETIC_IDENTITIES[identity].id;
    if (mode === "expire") {
      await expireSyntheticTenantMetadata(env.DB, githubId);
    } else {
      await resetSyntheticTenant(env.DB, githubId);
    }
    return json({ identity, mode }, 200);
  } catch {
    return json(
      { error: { code: "temporarily_unavailable", message: "Maintenance unavailable." } },
      503,
    );
  }
};
