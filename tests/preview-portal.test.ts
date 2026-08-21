import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("SoyaOS Cloud v0.2.0 stable Portal contract", () => {
  it("protects the Playground and links it from the real user flow", () => {
    const middleware = source("src/middleware.ts");
    const layout = source("src/layouts/Base.astro");
    const home = source("src/pages/index.astro");

    expect(middleware).toContain('"/playground"');
    expect(layout).toContain('href="/playground"');
    expect(layout).not.toContain('href="/webhook-debugger"');
    expect(home).toContain('href: "/playground"');
    expect(home).not.toContain("Webhook Debugger");
    expect(home).not.toContain("Coming soon");
  });

  it("keeps raw Playground keys out of browser persistence and logs", () => {
    const component = source("src/components/Playground.tsx");
    const client = source("src/lib/playground-client.ts");
    const combined = `${component}\n${client}`;

    expect(combined).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(combined).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(component).toContain('type="password"');
    expect(component).toContain("formatPlaygroundError(cause, key)");
    expect(component).toContain("Clear");
  });

  it("links real terms and privacy notices instead of Docs", () => {
    const login = source("src/pages/login.astro");
    const layout = source("src/layouts/Base.astro");
    const privacy = source("src/pages/privacy.astro");

    expect(login).toContain('href="/terms"');
    expect(login).toContain('href="/privacy"');
    expect(layout).toContain('href="/terms"');
    expect(layout).toContain('href="/privacy"');
    expect(privacy).toContain("24 hours");
    expect(privacy).toContain("Cloudflare Workers AI");
    expect(privacy).toContain("WNAM");
  });

  it("exposes request IDs and exact Trace filtering", () => {
    const usage = source("src/components/UsagePanel.tsx");

    expect(usage).toContain("Exact request ID");
    expect(usage).toContain("trace.requestId === normalizedFilter");
    expect(usage).toContain("{trace.requestId}");
  });

  it("registers the canonical Cloud alias and public status domain", () => {
    const wrangler = JSON.parse(source("wrangler.jsonc")) as {
      routes: Array<{ pattern: string; custom_domain: boolean }>;
    };
    const routes = wrangler.routes.map((route) => route.pattern);
    expect(routes).toContain("cloud.soyaos.ai");
    expect(routes).toContain("status.soyaos.ai");
    expect(source("src/pages/status.astro")).toContain("All systems operational");
  });
});
