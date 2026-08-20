/// <reference types="astro/client" />

type PortalEnv = {
  DB?: D1Database;
  AI?: Ai;
  API_KEY_PEPPER?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
};

interface Env extends PortalEnv {}

type CloudflareRuntime = import("@astrojs/cloudflare").Runtime;
type PortalSession = import("./lib/session").Session;

declare namespace App {
  interface Locals extends CloudflareRuntime {
    user: PortalSession | null;
  }
}
