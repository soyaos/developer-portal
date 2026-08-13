import { env } from "cloudflare:workers";

/**
 * Read bindings from Cloudflare's request runtime. Keeping this behind a tiny
 * module makes route tests deterministic without putting secrets on Locals.
 */
export function runtimeEnv(): PortalEnv {
  return env as PortalEnv;
}
