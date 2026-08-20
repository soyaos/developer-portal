import { describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE, setSession, unsealSession } from "../src/lib/session";
import { onRequest } from "../src/middleware";
import { GET as callback } from "../src/pages/auth/github/callback";
import {
  GET as start,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
} from "../src/pages/auth/github/start";
import { POST as logout } from "../src/pages/auth/logout";
import { MemoryCookies, routeContext } from "./helpers";

const ENV: PortalEnv = {
  GITHUB_OAUTH_CLIENT_ID: "client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "session-secret-with-at-least-thirty-two-bytes-123456",
};

describe("OAuth routes", () => {
  it("starts with a fresh state cookie and a direct GitHub redirect", async () => {
    const cookies = new MemoryCookies();
    const response = await start(
      routeContext(
        "https://developer.soyaos.ai/auth/github/start?returnTo=%2Fapi-keys",
        cookies,
        ENV,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("state")).toBe(cookies.values.get(OAUTH_STATE_COOKIE));
    expect(cookies.values.get(OAUTH_RETURN_COOKIE)).toBe("/api-keys");
    expect(cookies.writes.get(OAUTH_STATE_COOKIE)?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
  });

  it("fails closed when OAuth credentials are absent", async () => {
    const response = await start(
      routeContext("https://developer.soyaos.ai/auth/github/start", new MemoryCookies(), {}),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("GITHUB_OAUTH");
  });

  it("rejects state mismatch before contacting GitHub and clears one-shot cookies", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const cookies = new MemoryCookies({
      [OAUTH_STATE_COOKIE]: "expected-state",
      [OAUTH_RETURN_COOKIE]: "/api-keys",
    });
    const response = await callback(
      routeContext(
        "https://developer.soyaos.ai/auth/github/callback?code=sensitive-code&state=wrong-state",
        cookies,
        ENV,
      ),
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cookies.deletions).toEqual(new Set([OAUTH_STATE_COOKIE, OAUTH_RETURN_COOKIE]));
    expect(cookies.deletionOptions.get(OAUTH_STATE_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(cookies.deletionOptions.get(OAUTH_RETURN_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(await response.text()).not.toContain("sensitive-code");
  });

  it("rejects replay after consuming the state cookie", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const cookies = new MemoryCookies({
      [OAUTH_STATE_COOKIE]: "one-shot-state",
      [OAUTH_RETURN_COOKIE]: "/api-keys",
    });
    const first = await callback(
      routeContext(
        "https://developer.soyaos.ai/auth/github/callback?code=code&state=wrong",
        cookies,
        ENV,
      ),
    );
    const replay = await callback(
      routeContext(
        "https://developer.soyaos.ai/auth/github/callback?code=code&state=one-shot-state",
        cookies,
        ENV,
      ),
    );
    expect(first.status).toBe(400);
    expect(replay.status).toBe(400);
  });

  it("exchanges the code, discards the access token, and issues an encrypted session", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "github-access-token" }))
      .mockResolvedValueOnce(
        Response.json({
          id: 12345,
          login: "octocat",
          name: "The Octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/12345",
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const cookies = new MemoryCookies({
      [OAUTH_STATE_COOKIE]: "matching-state",
      [OAUTH_RETURN_COOKIE]: "/api-keys",
    });
    const response = await callback(
      routeContext(
        "https://developer.soyaos.ai/auth/github/callback?code=temporary-code&state=matching-state",
        cookies,
        ENV,
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/api-keys");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sealed = cookies.values.get(SESSION_COOKIE) ?? "";
    expect(sealed).not.toContain("github-access-token");
    expect(sealed).not.toContain("octocat");
    await expect(unsealSession(sealed, ENV.SESSION_SECRET ?? "")).resolves.toMatchObject({
      githubId: 12345,
      login: "octocat",
    });
  });

  it("does not expose provider error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          error: "bad_verification_code",
          error_description: "sensitive-provider-detail",
        }),
      ),
    );
    const cookies = new MemoryCookies({ [OAUTH_STATE_COOKIE]: "matching-state" });
    const response = await callback(
      routeContext(
        "https://developer.soyaos.ai/auth/github/callback?code=sensitive-code&state=matching-state",
        cookies,
        ENV,
      ),
    );
    const body = await response.text();
    expect(response.status).toBe(502);
    expect(body).not.toContain("sensitive-provider-detail");
    expect(body).not.toContain("sensitive-code");
  });

  it("clears the session only through the POST logout route", async () => {
    const cookies = new MemoryCookies({ [SESSION_COOKIE]: "sealed-value" });
    const response = await logout(
      routeContext("https://developer.soyaos.ai/auth/logout", cookies, ENV),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect(cookies.deletions.has(SESSION_COOKIE)).toBe(true);
    expect(cookies.deletionOptions.get(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });
});

describe("auth middleware", () => {
  it("redirects the Cloud alias to the canonical Portal without reading a session", async () => {
    const next = vi.fn(async () => new Response("must not run"));
    const response = (await onRequest(
      routeContext("https://cloud.soyaos.ai/legacy/path", new MemoryCookies(), {}),
      next,
    )) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://developer.soyaos.ai/");
    expect(next).not.toHaveBeenCalled();
  });

  it("serves only the status root through the dedicated status page", async () => {
    const next = vi.fn(async (rewrite?: string | URL | Request) => {
      expect(rewrite).toBe("/status");
      return new Response("status content");
    });
    const response = (await onRequest(
      routeContext("https://status.soyaos.ai/", new MemoryCookies(), {}),
      next,
    )) as Response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("status content");

    const hidden = (await onRequest(
      routeContext("https://status.soyaos.ai/login", new MemoryCookies(), {}),
      async () => new Response("must not run"),
    )) as Response;
    expect(hidden.status).toBe(404);
  });

  it("redirects an anonymous protected request and preserves a local return path", async () => {
    const response = (await onRequest(
      routeContext("https://developer.soyaos.ai/api-keys?tab=active", new MemoryCookies(), ENV),
      async () => new Response("protected content"),
    )) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/login?returnTo=%2Fapi-keys%3Ftab%3Dactive",
    );
  });

  it("protects the live Playground behind GitHub sign-in", async () => {
    const response = (await onRequest(
      routeContext("https://developer.soyaos.ai/playground", new MemoryCookies(), ENV),
      async () => new Response("playground"),
    )) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?returnTo=%2Fplayground");
  });

  it("allows public pages without a session", async () => {
    const response = (await onRequest(
      routeContext("https://developer.soyaos.ai/docs", new MemoryCookies(), ENV),
      async () => new Response("public content"),
    )) as Response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("public content");
  });

  it("returns JSON 401 for anonymous control-plane requests", async () => {
    const response = (await onRequest(
      routeContext(
        "https://developer.soyaos.ai/control/v1/api-keys",
        new MemoryCookies(),
        ENV,
      ),
      async () => new Response("must not run"),
    )) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "unauthorized", message: "Authentication required." },
    });
  });

  it("allows a valid session and prevents shared caching", async () => {
    const cookies = new MemoryCookies();
    await setSession(
      cookies.asAstroCookies(),
      createSession({ id: 12345, login: "octocat", name: null, avatarUrl: null }),
      ENV.SESSION_SECRET ?? "",
    );
    const context = routeContext("https://developer.soyaos.ai/api-keys", cookies, ENV);
    const response = (await onRequest(
      context,
      async () => new Response("protected content", { headers: { vary: "Accept-Encoding" } }),
    )) as Response;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect((context as { locals: { user: { login: string } | null } }).locals.user?.login).toBe(
      "octocat",
    );
  });

  it("redirects an authenticated user away from the login page", async () => {
    const cookies = new MemoryCookies();
    await setSession(
      cookies.asAstroCookies(),
      createSession({ id: 12345, login: "octocat", name: null, avatarUrl: null }),
      ENV.SESSION_SECRET ?? "",
    );
    const response = (await onRequest(
      routeContext(
        "https://developer.soyaos.ai/login?returnTo=%2Fapi-keys",
        cookies,
        ENV,
      ),
      async () => new Response("sign-in page"),
    )) as Response;
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/api-keys");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });
});
