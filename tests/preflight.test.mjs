import { describe, expect, it } from "vitest";
import { runProductionPreflight } from "../scripts/preflight.mjs";
import { validateProductionSecretNames } from "../scripts/check-secret-names.mjs";

function productionFetch(overrides = {}) {
  const responses = {
    "GET https://developer.soyaos.ai/": new Response("SoyaOS Public Preview /playground"),
    "GET https://developer.soyaos.ai/terms": new Response("Preview terms · no SLA"),
    "GET https://developer.soyaos.ai/privacy": new Response(
      "Privacy notice · Cloudflare Workers AI · 24 hours",
    ),
    "GET https://api.soyaos.ai/v1/models": Response.json(
      { error: { type: "authentication_error", code: "invalid_api_key" } },
      {
        status: 401,
        headers: { "content-type": "application/json", "x-request-id": "req_test" },
      },
    ),
    "GET https://cloud.soyaos.ai/": new Response(null, {
      status: 302,
      headers: { location: "https://developer.soyaos.ai/" },
    }),
    "GET https://status.soyaos.ai/": new Response(
      "SoyaOS Cloud Status · All systems operational · Public Preview",
    ),
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
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every((check) => check.result === "pass")).toBe(true);
  });

  it("fails closed when the canonical Cloud redirect drifts", async () => {
    await expect(
      runProductionPreflight(
        productionFetch({
          "GET https://cloud.soyaos.ai/": new Response(null, {
            status: 301,
            headers: { location: "https://developer.soyaos.ai/" },
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
