import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, unsealSession } from "../src/lib/session";
import { POST } from "../src/pages/auth/e2e/session";
import { MemoryCookies, routeContext } from "./helpers";

const E2E_SECRET = "e2e-bootstrap-secret-with-at-least-thirty-two-bytes";
const SESSION_SECRET = "session-secret-with-at-least-thirty-two-bytes";

function request(
  env: PortalEnv,
  cookies = new MemoryCookies(),
  identity: unknown = "tenant-a",
  token = E2E_SECRET,
) {
  const rawUrl = "https://developer-staging.soyaos.ai/auth/e2e/session";
  const base = routeContext(rawUrl, cookies, env) as unknown as {
    cookies: unknown;
    locals: unknown;
    url: URL;
  };
  const body = JSON.stringify({ identity });
  return {
    cookies,
    context: {
      ...base,
      request: new Request(rawUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body,
      }),
    } as never,
  };
}

describe("staging E2E session bootstrap", () => {
  it("is indistinguishable from a missing route outside staging", async () => {
    const { context, cookies } = request({
      DEPLOYMENT_ENV: "production",
      E2E_BOOTSTRAP_SECRET: E2E_SECRET,
      SESSION_SECRET,
    });
    const response = await POST(context);
    expect(response.status).toBe(404);
    expect(cookies.values.has(SESSION_COOKIE)).toBe(false);
  });

  it("fails closed when the staging secret is absent or too short", async () => {
    const { context } = request({ DEPLOYMENT_ENV: "staging", SESSION_SECRET });
    const response = await POST(context);
    expect(response.status).toBe(404);
  });

  it("rejects an invalid bearer token without setting a cookie", async () => {
    const { context, cookies } = request(
      {
        DEPLOYMENT_ENV: "staging",
        E2E_BOOTSTRAP_SECRET: E2E_SECRET,
        SESSION_SECRET,
      },
      new MemoryCookies(),
      "tenant-a",
      "wrong-token",
    );
    const response = await POST(context);
    expect(response.status).toBe(401);
    expect(cookies.values.has(SESSION_COOKIE)).toBe(false);
  });

  it("accepts only the two fixed synthetic identities", async () => {
    const { context } = request(
      {
        DEPLOYMENT_ENV: "staging",
        E2E_BOOTSTRAP_SECRET: E2E_SECRET,
        SESSION_SECRET,
      },
      new MemoryCookies(),
      "tenant-c",
    );
    const response = await POST(context);
    expect(response.status).toBe(400);
  });

  it.each([
    ["tenant-a", 9_007_199_254_740_001, "soyaos-e2e-tenant-a"],
    ["tenant-b", 9_007_199_254_740_002, "soyaos-e2e-tenant-b"],
  ])("issues a normal encrypted session for %s", async (identity, githubId, login) => {
    const { context, cookies } = request(
      {
        DEPLOYMENT_ENV: "staging",
        E2E_BOOTSTRAP_SECRET: E2E_SECRET,
        SESSION_SECRET,
      },
      new MemoryCookies(),
      identity,
    );
    const response = await POST(context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const sealed = cookies.values.get(SESSION_COOKIE) ?? "";
    expect(sealed).not.toContain(login);
    await expect(unsealSession(sealed, SESSION_SECRET)).resolves.toMatchObject({
      githubId,
      login,
    });
  });
});
