import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function englishDictionary(): Record<string, unknown> {
  return JSON.parse(source("src/locales/en.json")) as Record<string, unknown>;
}

describe("SoyaOS Cloud v0.2.0 stable Portal contract", () => {
  it("protects the Playground and builds navigation from locale-aware links", () => {
    const middleware = source("src/middleware.ts");
    const layout = source("src/layouts/Base.astro");
    const home = source("src/pages/index.astro");

    expect(middleware).toContain('"/playground"');
    expect(layout).toContain('href={href("/playground")}');
    expect(layout).not.toContain('href={href("/webhook-debugger")}');
    expect(home).toContain("localizePath(locale, card.path)");
  });

  it("keeps raw Playground keys out of browser persistence and logs", () => {
    const component = source("src/components/Playground.tsx");
    const client = source("src/lib/playground-client.ts");
    const combined = `${component}\n${client}`;

    expect(combined).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(combined).not.toMatch(/console\.(?:log|debug|info|warn|error)/);
    expect(component).toContain('type="password"');
    expect(component).toContain("formatPlaygroundError(cause, key, messages)");
    expect(component).toContain("messages.clear");
  });

  it("links localized terms and privacy notices", () => {
    const login = source("src/pages/login.astro");
    const layout = source("src/layouts/Base.astro");
    const english = JSON.stringify(englishDictionary());

    expect(login).toContain('localizePath(locale, "/terms")');
    expect(login).toContain('localizePath(locale, "/privacy")');
    expect(layout).toContain('href={href("/terms")}');
    expect(layout).toContain('href={href("/privacy")}');
    expect(english).toContain("24 hours");
    expect(english).toContain("Cloudflare Workers AI");
    expect(english).toContain("WNAM");
  });

  it("exposes request IDs and exact Trace filtering", () => {
    const usage = source("src/components/UsagePanel.tsx");
    const english = JSON.stringify(englishDictionary());

    expect(english).toContain("Exact request ID");
    expect(usage).toContain("trace.requestId === normalizedFilter");
    expect(usage).toContain("{trace.requestId}");
  });

  it("registers Cloud aliases and localizes public status content", () => {
    const wrangler = JSON.parse(source("wrangler.jsonc")) as {
      routes: Array<{ pattern: string; custom_domain: boolean }>;
    };
    const routes = wrangler.routes.map((route) => route.pattern);
    expect(routes).toContain("cloud.soyaos.ai");
    expect(routes).toContain("status.soyaos.ai");
    expect(JSON.stringify(englishDictionary())).toContain("All systems operational");
    expect(source("src/pages/status.astro")).toContain("getDictionary(locale).status");
  });
});
