// Session helpers for the SoyaOS Developer Portal.
//
// During alpha we keep the session payload deliberately tiny — just a
// session token string plus the GitHub login. The token itself is
// minted by the control plane in exchange for a GitHub OAuth `code`.
//
// TODO(soyaos): replace the mock exchange in /auth/github/callback with a
// real call to `POST /control/v0/auth/github/exchange` and have it return
// a signed, opaque token bound to the issuing user.

import type { AstroCookies } from "astro";

export const SESSION_COOKIE = "soyaos_session";

export interface Session {
  token: string;
  login: string;
  issuedAt: string; // ISO-8601
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: true,
  path: "/",
  // 12 hours — alpha default; production should mint shorter-lived
  // tokens with a refresh dance.
  maxAge: 60 * 60 * 12,
};

export function setSession(cookies: AstroCookies, session: Session): void {
  cookies.set(SESSION_COOKIE, JSON.stringify(session), COOKIE_OPTS);
}

export function getSession(cookies: AstroCookies): Session | null {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.token || !parsed.login) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
