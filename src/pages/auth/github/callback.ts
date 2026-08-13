import type { APIRoute } from "astro";
import {
  constantTimeEqual,
  exchangeCode,
  fetchGitHubUser,
  oauthCallbackUrl,
  sanitizeReturnTo,
  validateOAuthConfig,
} from "../../../lib/github-oauth";
import { runtimeEnv } from "../../../lib/runtime-env";
import { createSession, setSession } from "../../../lib/session";
import { OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE } from "./start";

export const prerender = false;

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
};

function failure(message: string, status: number): Response {
  return new Response(message, { status, headers: NO_STORE_HEADERS });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const expectedState = cookies.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const returnTo = sanitizeReturnTo(cookies.get(OAUTH_RETURN_COOKIE)?.value ?? null);
  cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });
  cookies.delete(OAUTH_RETURN_COOKIE, { path: "/" });

  if (url.searchParams.has("error")) {
    return failure("GitHub sign-in was cancelled or rejected.", 400);
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state || !expectedState || !constantTimeEqual(state, expectedState)) {
    return failure("Invalid or expired OAuth request. Start the sign-in flow again.", 400);
  }

  try {
    const env = runtimeEnv();
    const config = validateOAuthConfig(env);
    const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
    if (!sessionSecret) return failure("GitHub sign-in is temporarily unavailable.", 503);

    const redirectUri = oauthCallbackUrl(url);
    const accessToken = await exchangeCode(config, code, redirectUri);
    const user = await fetchGitHubUser(accessToken);
    await setSession(cookies, createSession(user), sessionSecret);

    return new Response(null, {
      status: 303,
      headers: { ...NO_STORE_HEADERS, location: returnTo },
    });
  } catch {
    return failure("GitHub sign-in could not be completed. Please try again.", 502);
  }
};
