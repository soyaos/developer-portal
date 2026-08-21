import { pathToFileURL } from "node:url";

const PORTAL = "https://developer.soyaos.ai";
const API = "https://api.soyaos.ai";
const CLOUD = "https://cloud.soyaos.ai";
const STATUS = "https://status.soyaos.ai";

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

async function expectNotFound(fetcher, path) {
  const response = await fetchWithRetry(fetcher, `${PORTAL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: "tenant-a" }),
    redirect: "error",
  });
  invariant(response.status === 404, `${path}: expected 404, got ${response.status}`);
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
    expectPage(fetcher, "portal-home", `${PORTAL}/`, ["SoyaOS", "v0.2.0 Stable", "/playground"]),
  );
  await check("portal-terms", () =>
    expectPage(fetcher, "portal-terms", `${PORTAL}/terms`, ["Service terms", "no SLA"]),
  );
  await check("portal-privacy", () =>
    expectPage(fetcher, "portal-privacy", `${PORTAL}/privacy`, [
      "Privacy notice",
      "Cloudflare Workers AI",
      "24 hours",
    ]),
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
    const response = await fetchWithRetry(fetcher, `${CLOUD}/`, { redirect: "manual" });
    invariant(response.status === 302, `cloud-canonical-redirect: expected 302, got ${response.status}`);
    invariant(
      response.headers.get("location") === `${PORTAL}/`,
      "cloud-canonical-redirect: invalid location",
    );
  });
  await check("public-status-page", () =>
    expectPage(fetcher, "public-status-page", `${STATUS}/`, [
      "SoyaOS Cloud Status",
      "All systems operational",
      "v0.2.0",
    ]),
  );
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
