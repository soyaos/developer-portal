import { pathToFileURL } from "node:url";

const PORTAL = "https://developer.soyaos.ai";
const API = "https://api.soyaos.ai";
const CLOUD = "https://cloud.soyaos.ai";
const STATUS = "https://status.soyaos.ai";
const STAGING = "https://developer-staging.soyaos.ai";
const API_STAGING = "https://api-staging.soyaos.ai";

function positiveIntegerEnvironment(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const RETRY_ATTEMPTS = positiveIntegerEnvironment("PREFLIGHT_RETRY_ATTEMPTS", 13);
const RETRY_DELAY_MS = positiveIntegerEnvironment("PREFLIGHT_RETRY_DELAY_MS", 5_000);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchWithRetry(fetcher, input, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetcher(input, {
        ...init,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(`request unavailable after ${RETRY_ATTEMPTS} attempts`, {
    cause: lastError,
  });
}

async function expectPage(fetcher, name, url, markers) {
  const response = await fetchWithRetry(fetcher, url, { redirect: "error" });
  invariant(response.status === 200, `${name}: expected 200, got ${response.status}`);
  const body = await response.text();
  for (const marker of markers) {
    invariant(body.includes(marker), `${name}: missing contract marker ${marker}`);
  }
}

async function expectMarkdown(fetcher, name, url, canonical, markers) {
  const response = await fetchWithRetry(fetcher, url, { redirect: "error" });
  invariant(response.status === 200, `${name}: expected 200, got ${response.status}`);
  invariant(
    response.headers.get("content-type") === "text/markdown; charset=utf-8",
    `${name}: expected text/markdown`,
  );
  invariant(response.headers.get("x-robots-tag") === "noindex", `${name}: expected noindex`);
  invariant(
    response.headers.get("link") === `<${canonical}>; rel="canonical"`,
    `${name}: invalid canonical Link`,
  );
  const body = await response.text();
  for (const marker of markers) {
    invariant(body.includes(marker), `${name}: missing contract marker ${marker}`);
  }
}

async function expectNotFound(fetcher, path) {
  const response = await fetchWithRetry(fetcher, `${PORTAL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: "tenant-a" }),
    redirect: "error",
  });
  invariant(response.status === 404, `${path}: expected 404, got ${response.status}`);
}

async function expectText(fetcher, name, url, contentType, markers, init = {}) {
  const response = await fetchWithRetry(fetcher, url, { redirect: "error", ...init });
  invariant(response.status === 200, `${name}: expected 200, got ${response.status}`);
  invariant(
    response.headers.get("content-type")?.startsWith(contentType),
    `${name}: expected ${contentType}`,
  );
  const body = await response.text();
  for (const marker of markers) {
    invariant(body.includes(marker), `${name}: missing contract marker ${marker}`);
  }
  return response;
}

export async function runProductionPreflight(fetcher = fetch) {
  const checks = [];
  const check = async (name, operation) => {
    try {
      await operation();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown failure";
      throw new Error(`${name}: ${detail}`, { cause: error });
    }
    checks.push({ name, result: "pass" });
  };

  await check("portal-home", () =>
    expectPage(fetcher, "portal-home", `${PORTAL}/en`, [
      'lang="en-US"',
      "v0.2.0 Stable",
      "/en/playground",
      'type="text/markdown"',
      'href="https://developer.soyaos.ai/en.md"',
    ]),
  );
  await check("portal-terms", () =>
    expectPage(fetcher, "portal-terms", `${PORTAL}/en/terms`, ["Service terms", "no SLA"]),
  );
  await check("portal-privacy", () =>
    expectPage(fetcher, "portal-privacy", `${PORTAL}/en/privacy`, [
      "Privacy notice",
      "Cloudflare Workers AI",
      "24 hours",
    ]),
  );
  await check("portal-home-markdown", () =>
    expectMarkdown(fetcher, "portal-home-markdown", `${PORTAL}/en.md`, `${PORTAL}/en`, [
      "# SoyaOS Developer Portal",
      `Canonical HTML: ${PORTAL}/en`,
    ]),
  );
  await check("portal-docs-markdown", () =>
    expectMarkdown(
      fetcher,
      "portal-docs-markdown",
      `${PORTAL}/en/docs.md`,
      `${PORTAL}/en/docs`,
      ["# Documentation", "https://soyaos.ai/en/docs"],
    ),
  );
  await check("api-anonymous-contract", async () => {
    const response = await fetchWithRetry(fetcher, `${API}/v1/models`, { redirect: "error" });
    invariant(response.status === 401, `api-anonymous-contract: expected 401, got ${response.status}`);
    invariant(response.headers.get("x-request-id"), "api-anonymous-contract: missing x-request-id");
    invariant(
      response.headers.get("content-type")?.startsWith("application/json"),
      "api-anonymous-contract: expected JSON",
    );
    const payload = await response.json();
    invariant(
      payload?.error?.type === "authentication_error" && payload?.error?.code === "invalid_api_key",
      "api-anonymous-contract: invalid error envelope",
    );
  });
  await check("cloud-canonical-redirect", async () => {
    const response = await fetchWithRetry(fetcher, `${CLOUD}/en`, { redirect: "manual" });
    invariant(response.status === 302, `cloud-canonical-redirect: expected 302, got ${response.status}`);
    invariant(
      response.headers.get("location") === `${PORTAL}/en`,
      "cloud-canonical-redirect: invalid location",
    );
  });
  await check("public-status-page", () =>
    expectPage(fetcher, "public-status-page", `${STATUS}/en`, [
      "SoyaOS Cloud Status",
      "All systems operational",
      "v0.2.0",
    ]),
  );
  await check("portal-discovery", async () => {
    await expectText(fetcher, "portal-robots", `${PORTAL}/robots.txt`, "text/plain", [
      "Allow: /",
      `Sitemap: ${PORTAL}/sitemap.xml`,
      "Disallow: /control/",
    ]);
    await expectText(fetcher, "portal-sitemap", `${PORTAL}/sitemap.xml`, "application/xml", [
      `<loc>${PORTAL}/zh</loc>`,
      `<loc>${PORTAL}/zh-hant/privacy</loc>`,
      `<loc>${PORTAL}/en/docs</loc>`,
      'hreflang="x-default"',
    ]);
    await expectText(fetcher, "portal-llms", `${PORTAL}/llms.txt`, "text/markdown", [
      "# SoyaOS Developer Portal",
      `${PORTAL}/zh.md`,
      `${PORTAL}/zh-hant/terms.md`,
      `${PORTAL}/en/privacy.md`,
    ]);
  });
  await check("status-discovery", async () => {
    await expectText(fetcher, "status-robots", `${STATUS}/robots.txt`, "text/plain", [
      `Sitemap: ${STATUS}/sitemap.xml`,
    ]);
    await expectText(fetcher, "status-sitemap", `${STATUS}/sitemap.xml`, "application/xml", [
      `<loc>${STATUS}/zh</loc>`,
      `<loc>${STATUS}/zh-hant</loc>`,
      `<loc>${STATUS}/en</loc>`,
    ]);
    await expectText(fetcher, "status-llms", `${STATUS}/llms.txt`, "text/markdown", [
      "# SoyaOS Cloud Status",
      `${STATUS}/zh-hant`,
    ]);
  });
  await check("api-discovery", async () => {
    await expectText(fetcher, "api-robots", `${API}/robots.txt`, "text/plain", [
      "Disallow: /",
      "Allow: /llms.txt",
      "Sitemap: https://soyaos.ai/sitemap.xml",
    ]);
    await expectText(fetcher, "api-llms", `${API}/llms.txt`, "text/markdown", [
      "# SoyaOS API",
      "https://soyaos.ai/en/docs/http-api.md",
    ]);
    const sitemap = await fetchWithRetry(fetcher, `${API}/sitemap.xml`, { redirect: "manual" });
    invariant(sitemap.status === 308, `api-sitemap: expected 308, got ${sitemap.status}`);
    invariant(sitemap.headers.get("location") === "https://soyaos.ai/sitemap.xml", "api-sitemap: invalid location");
  });
  await check("cloud-discovery-redirect", async () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/llms.txt"]) {
      const response = await fetchWithRetry(fetcher, `${CLOUD}${path}`, { redirect: "manual" });
      invariant(response.status === 302, `cloud${path}: expected 302, got ${response.status}`);
      invariant(response.headers.get("location") === `${PORTAL}${path}`, `cloud${path}: invalid location`);
    }
  });
  await check("staging-crawl-policy", async () => {
    for (const origin of [STAGING, API_STAGING]) {
      const response = await expectText(fetcher, "staging-robots", `${origin}/robots.txt`, "text/plain", [
        "User-agent: *\nDisallow: /",
      ]);
      invariant(response.headers.get("x-robots-tag") === "noindex, nofollow", `${origin}: missing noindex policy`);
    }
  });
  await check("singular-llm-path-absent", async () => {
    const response = await fetchWithRetry(fetcher, `${PORTAL}/llm.txt`, { redirect: "error" });
    invariant(response.status === 404, `singular-llm-path-absent: expected 404, got ${response.status}`);
  });
  await check("production-e2e-session-disabled", () => expectNotFound(fetcher, "/auth/e2e/session"));
  await check("production-e2e-reset-disabled", () => expectNotFound(fetcher, "/auth/e2e/reset"));

  return {
    environment: "production",
    checkedAt: new Date().toISOString(),
    result: "pass",
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(await runProductionPreflight(), null, 2));
  } catch (error) {
    console.error(
      JSON.stringify({
        environment: "production",
        checkedAt: new Date().toISOString(),
        result: "fail",
        error: error instanceof Error ? error.message : "unknown preflight failure",
      }),
    );
    process.exitCode = 1;
  }
}
