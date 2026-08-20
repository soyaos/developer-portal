import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  constantTimeEqual,
  createOAuthState,
  exchangeCode,
  fetchGitHubUser,
  oauthCallbackUrl,
  OAuthError,
  sanitizeReturnTo,
  validateOAuthConfig,
} from "../src/lib/github-oauth";

describe("GitHub OAuth helpers", () => {
  it("creates unique 256-bit URL-safe state values", () => {
    const first = createOAuthState();
    const second = createOAuthState();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("builds the documented GitHub authorize URL", () => {
    const url = buildAuthorizeUrl(
      "client-id",
      "https://developer.soyaos.ai/auth/github/callback",
      "state-value",
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://developer.soyaos.ai/auth/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("state")).toBe("state-value");
  });

  it("requires both runtime credentials", () => {
    expect(() => validateOAuthConfig({})).toThrow(OAuthError);
    expect(
      validateOAuthConfig({
        GITHUB_OAUTH_CLIENT_ID: " client-id ",
        GITHUB_OAUTH_CLIENT_SECRET: " client-secret ",
      }),
    ).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
  });

  it("compares state without an early length shortcut", () => {
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "different")).toBe(false);
    expect(constantTimeEqual("same", "samf")).toBe(false);
  });

  it.each([
    [null, "/"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/api-keys?tab=active", "/api-keys?tab=active"],
  ])("sanitizes returnTo %s", (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it("pins production and staging callbacks and rejects attacker-controlled hosts", () => {
    expect(oauthCallbackUrl(new URL("https://developer.soyaos.ai/auth/github/start"))).toBe(
      "https://developer.soyaos.ai/auth/github/callback",
    );
    expect(oauthCallbackUrl(new URL("http://localhost:4321/auth/github/start"))).toBe(
      "http://localhost:4321/auth/github/callback",
    );
    expect(
      oauthCallbackUrl(new URL("https://developer-staging.soyaos.ai/auth/github/start")),
    ).toBe("https://developer-staging.soyaos.ai/auth/github/callback");
    expect(() => oauthCallbackUrl(new URL("https://preview.pages.dev/auth/github/start"))).toThrow(
      OAuthError,
    );
  });

  it("exchanges a code without putting credentials in the URL", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ access_token: "github-access-token", token_type: "bearer" }),
    );
    const token = await exchangeCode(
      { clientId: "client-id", clientSecret: "client-secret" },
      "temporary-code",
      "https://developer.soyaos.ai/auth/github/callback",
      fetcher as typeof fetch,
    );
    expect(token).toBe("github-access-token");
    const [requestUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(requestUrl).toBe("https://github.com/login/oauth/access_token");
    expect(requestUrl).not.toContain("client-secret");
    expect(init?.method).toBe("POST");
    const body = init?.body as URLSearchParams;
    expect(body.get("client_secret")).toBe("client-secret");
    expect(body.get("code")).toBe("temporary-code");
  });

  it("normalizes provider token errors", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: "bad_verification_code", error_description: "sensitive detail" }),
    );
    await expect(
      exchangeCode(
        { clientId: "client-id", clientSecret: "client-secret" },
        "bad-code",
        "https://developer.soyaos.ai/auth/github/callback",
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "token_exchange_failed" });
  });

  it("returns only the GitHub identity fields needed by the portal", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        id: 12345,
        login: "octocat",
        name: "The Octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/12345",
        private_email: "must-not-be-copied@example.com",
      }),
    );
    await expect(fetchGitHubUser("access-token", fetcher as typeof fetch)).resolves.toEqual({
      id: 12345,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://avatars.githubusercontent.com/u/12345",
    });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      authorization: "Bearer access-token",
    });
  });
});
