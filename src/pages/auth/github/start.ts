import type { APIRoute } from "astro";
import {
  buildAuthorizeUrl,
  createOAuthState,
  oauthCallbackUrl,
  sanitizeReturnTo,
  validateOAuthConfig,
} from "../../../lib/github-oauth";
import { runtimeEnv } from "../../../lib/runtime-env";

export const prerender = false;

export const OAUTH_STATE_COOKIE = "__Host-soyaos_oauth_state";
export const OAUTH_RETURN_COOKIE = "__Host-soyaos_oauth_return_to";

export const OAUTH_COOKIE_DELETE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
};

const TRANSIENT_COOKIE_OPTIONS = {
  ...OAUTH_COOKIE_DELETE_OPTIONS,
  maxAge: 600,
};

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
};

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const config = validateOAuthConfig(runtimeEnv());
    const state = createOAuthState();
    const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));
    const redirectUri = oauthCallbackUrl(url);

    cookies.set(OAUTH_STATE_COOKIE, state, TRANSIENT_COOKIE_OPTIONS);
    cookies.set(OAUTH_RETURN_COOKIE, returnTo, TRANSIENT_COOKIE_OPTIONS);

    return new Response(null, {
      status: 302,
      headers: {
        ...NO_STORE_HEADERS,
        location: buildAuthorizeUrl(config.clientId, redirectUri, state).toString(),
      },
    });
  } catch {
    return new Response("GitHub sign-in is temporarily unavailable.", {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }
};
