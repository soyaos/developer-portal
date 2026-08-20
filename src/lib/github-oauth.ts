const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const REQUEST_TIMEOUT_MS = 10_000;
const PRODUCTION_ORIGIN = "https://developer.soyaos.ai";
const STAGING_ORIGIN = "https://developer-staging.soyaos.ai";

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export class OAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createOAuthState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): URL {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url;
}

export function validateOAuthConfig(env: PortalEnv): GitHubOAuthConfig {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new OAuthError("not_configured", "GitHub OAuth is not configured.");
  }
  return { clientId, clientSecret };
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, PRODUCTION_ORIGIN);
    if (parsed.origin !== PRODUCTION_ORIGIN) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function oauthCallbackUrl(requestUrl: URL): string {
  const hostname = requestUrl.hostname.toLowerCase();
  if (hostname === "developer.soyaos.ai") {
    return `${PRODUCTION_ORIGIN}/auth/github/callback`;
  }
  if (hostname === "developer-staging.soyaos.ai") {
    return `${STAGING_ORIGIN}/auth/github/callback`;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return new URL("/auth/github/callback", requestUrl.origin).toString();
  }
  throw new OAuthError("invalid_host", "GitHub OAuth is unavailable on this host.");
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch {
    throw new OAuthError("github_unavailable", "GitHub OAuth is unavailable.");
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Convert provider-specific parsing failures into a stable public error.
  }
  throw new OAuthError("invalid_github_response", "GitHub returned an invalid response.");
}

export async function exchangeCode(
  config: GitHubOAuthConfig,
  code: string,
  redirectUri: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchWithTimeout(fetcher, GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const payload = await parseJsonObject(response);
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!response.ok || !accessToken) {
    throw new OAuthError("token_exchange_failed", "GitHub authorization was rejected.");
  }
  return accessToken;
}

export async function fetchGitHubUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GitHubUser> {
  const response = await fetchWithTimeout(fetcher, GITHUB_USER_URL, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "SoyaOS-Developer-Portal",
      "x-github-api-version": "2022-11-28",
    },
  });
  const payload = await parseJsonObject(response);
  const id = typeof payload.id === "number" ? payload.id : 0;
  const login = typeof payload.login === "string" ? payload.login.trim() : "";
  if (!response.ok || !Number.isSafeInteger(id) || id <= 0 || !login) {
    throw new OAuthError("user_lookup_failed", "GitHub user lookup failed.");
  }
  return {
    id,
    login,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : null,
  };
}
