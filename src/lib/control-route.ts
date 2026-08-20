import type { APIContext } from "astro";
import { ControlPlaneError } from "./control-plane";
import { runtimeEnv } from "./runtime-env";

const JSON_HEADERS = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
};

export function controlContext(context: APIContext): {
  db: D1Database;
  env: PortalEnv;
  user: NonNullable<App.Locals["user"]>;
} {
  const user = context.locals.user;
  if (!user) throw new ControlPlaneError(401, "unauthorized", "Authentication required.");
  const env = runtimeEnv();
  if (!env.DB) {
    throw new ControlPlaneError(503, "database_unavailable", "Control plane is unavailable.");
  }
  return { db: env.DB, env, user };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(JSON_HEADERS)) headers.set(name, value);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function controlError(error: unknown): Response {
  if (error instanceof ControlPlaneError) {
    return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error(
    JSON.stringify({
      message: "unhandled control-plane error",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return json(
    { error: { code: "internal_error", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}
