import { describe, expect, it } from "vitest";
import { runProductionPreflight } from "../scripts/preflight.mjs";
import { validateProductionSecretNames } from "../scripts/check-secret-names.mjs";

function productionFetch(overrides = {}) {
  const responses = {
    "GET https://developer.soyaos.ai/en": new Response(
      '<html lang="en-US">SoyaOS v0.2.0 Stable /en/playground type="text/markdown" href="https://developer.soyaos.ai/en.md"</html>',
    ),
    "GET https://developer.soyaos.ai/en/terms": new Response("Service terms · no SLA"),
    "GET https://developer.soyaos.ai/en/privacy": new Response(
      "Privacy notice · Cloudflare Workers AI · 24 hours",
    ),
    "GET https://developer.soyaos.ai/en.md": new Response(
      "# SoyaOS Developer Portal\n\nCanonical HTML: https://developer.soyaos.ai/en",
      {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "x-robots-tag": "noindex",
          link: '<https://developer.soyaos.ai/en>; rel="canonical"',
        },
      },
    ),
    "GET https://developer.soyaos.ai/en/docs.md": new Response(
      "# Documentation\n\nhttps://soyaos.ai/en/docs",
      {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "x-robots-tag": "noindex",
          link: '<https://developer.soyaos.ai/en/docs>; rel="canonical"',
        },
      },
    ),
    "GET https://api.soyaos.ai/v1/models": Response.json(
      { error: { type: "authentication_error", code: "invalid_api_key" } },
      {
        status: 401,
        headers: { "content-type": "application/json", "x-request-id": "req_test" },
      },
    ),
    "GET https://cloud.soyaos.ai/en": new Response(null, {
      status: 302,
      headers: { location: "https://developer.soyaos.ai/en" },
    }),
    "GET https://status.soyaos.ai/en": new Response(
      "SoyaOS Cloud Status · All systems operational · v0.2.0",
    ),
    "GET https://developer.soyaos.ai/en/docs/?from=legacy": new Response(null, {
      status: 308,
      headers: { location: "/en/docs?from=legacy" },
    }),
    "GET https://status.soyaos.ai/en/": new Response(null, {
      status: 308,
      headers: { location: "/en" },
    }),
    "GET https://cloud.soyaos.ai/en/docs/": new Response(null, {
      status: 308,
      headers: { location: "https://developer.soyaos.ai/en/docs" },
    }),
    "GET https://developer.soyaos.ai/robots.txt": new Response(
      "User-agent: *\nAllow: /\nDisallow: /control/\nSitemap: https://developer.soyaos.ai/sitemap.xml\n",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    ),
    "GET https://developer.soyaos.ai/sitemap.xml": new Response(
      '<urlset><url><loc>https://developer.soyaos.ai/zh</loc><xhtml:link hreflang="x-default" /></url><url><loc>https://developer.soyaos.ai/zh-hant/privacy</loc></url><url><loc>https://developer.soyaos.ai/en/docs</loc></url></urlset>',
      { headers: { "content-type": "application/xml; charset=utf-8" } },
    ),
    "GET https://developer.soyaos.ai/llms.txt": new Response(
      "# SoyaOS Developer Portal\nhttps://developer.soyaos.ai/zh.md\nhttps://developer.soyaos.ai/zh-hant/terms.md\nhttps://developer.soyaos.ai/en/privacy.md",
      { headers: { "content-type": "text/markdown; charset=utf-8" } },
    ),
    "GET https://status.soyaos.ai/robots.txt": new Response(
      "Sitemap: https://status.soyaos.ai/sitemap.xml",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    ),
    "GET https://status.soyaos.ai/sitemap.xml": new Response(
      "<loc>https://status.soyaos.ai/zh</loc><loc>https://status.soyaos.ai/zh-hant</loc><loc>https://status.soyaos.ai/en</loc>",
      { headers: { "content-type": "application/xml; charset=utf-8" } },
    ),
    "GET https://status.soyaos.ai/llms.txt": new Response(
      "# SoyaOS Cloud Status\nhttps://status.soyaos.ai/zh-hant",
      { headers: { "content-type": "text/markdown; charset=utf-8" } },
    ),
    "GET https://api.soyaos.ai/robots.txt": new Response(
      "Disallow: /\nAllow: /llms.txt\nSitemap: https://soyaos.ai/sitemap.xml",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    ),
    "GET https://api.soyaos.ai/llms.txt": new Response(
      "# SoyaOS API\nhttps://soyaos.ai/en/docs/http-api.md",
      { headers: { "content-type": "text/markdown; charset=utf-8" } },
    ),
    "GET https://api.soyaos.ai/sitemap.xml": new Response(null, {
      status: 308,
      headers: { location: "https://soyaos.ai/sitemap.xml" },
    }),
    "GET https://cloud.soyaos.ai/robots.txt": new Response(null, {
      status: 302,
      headers: { location: "https://developer.soyaos.ai/robots.txt" },
    }),
    "GET https://cloud.soyaos.ai/sitemap.xml": new Response(null, {
      status: 302,
      headers: { location: "https://developer.soyaos.ai/sitemap.xml" },
    }),
    "GET https://cloud.soyaos.ai/llms.txt": new Response(null, {
      status: 302,
      headers: { location: "https://developer.soyaos.ai/llms.txt" },
    }),
    "GET https://developer-staging.soyaos.ai/robots.txt": new Response(
      "User-agent: *\nDisallow: /\n",
      { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" } },
    ),
    "GET https://api-staging.soyaos.ai/robots.txt": new Response(
      "User-agent: *\nDisallow: /\n",
      { headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex, nofollow" } },
    ),
    "GET https://developer.soyaos.ai/llm.txt": new Response("not found", { status: 404 }),
    "POST https://developer.soyaos.ai/auth/e2e/session": new Response("not found", { status: 404 }),
    "POST https://developer.soyaos.ai/auth/e2e/reset": new Response("not found", { status: 404 }),
    ...overrides,
  };
  return async (input, init = {}) => {
    const key = `${init.method ?? "GET"} ${String(input)}`;
    const response = responses[key];
    if (!response) throw new Error(`unexpected request ${key}`);
    return response.clone();
  };
}

describe("production preflight", () => {
  it("passes all read-only production contracts", async () => {
    const result = await runProductionPreflight(productionFetch());
    expect(result.result).toBe("pass");
    expect(result.checks).toHaveLength(17);
    expect(result.checks.every((check) => check.result === "pass")).toBe(true);
  });

  it("fails closed when the canonical Cloud redirect drifts", async () => {
    await expect(
      runProductionPreflight(
        productionFetch({
          "GET https://cloud.soyaos.ai/en": new Response(null, {
            status: 301,
            headers: { location: "https://developer.soyaos.ai/en" },
          }),
        }),
      ),
    ).rejects.toThrow("cloud-canonical-redirect: expected 302");
  });
});

describe("production secret-name check", () => {
  it("requires the four production secrets and rejects the staging bootstrap secret", () => {
    expect(
      validateProductionSecretNames([
        "SESSION_SECRET",
        "GITHUB_OAUTH_CLIENT_SECRET",
        "API_KEY_PEPPER",
        "GITHUB_OAUTH_CLIENT_ID",
      ]),
    ).toMatchObject({ result: "pass", missing: [], forbidden: [] });

    expect(
      validateProductionSecretNames(["SESSION_SECRET", "E2E_BOOTSTRAP_SECRET"]),
    ).toMatchObject({
      result: "fail",
      forbidden: ["E2E_BOOTSTRAP_SECRET"],
    });
  });
});
