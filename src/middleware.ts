import type { MiddlewareHandler } from "astro";
import { sanitizeReturnTo } from "./lib/github-oauth";
import { runtimeEnv } from "./lib/runtime-env";
import { clearSession, getSession } from "./lib/session";

const PROTECTED_PATHS = new Set(["/api-keys", "/usage", "/webhook-debugger"]);

export const onRequest: MiddlewareHandler = async (context, next) => {
  const secret = runtimeEnv().SESSION_SECRET?.trim() ?? "";
  const session = secret ? await getSession(context.cookies, secret) : null;
  context.locals.user = session;

  if (context.cookies.has("__Host-soyaos_session") && !session) {
    clearSession(context.cookies);
  }

  const pathname = context.url.pathname.replace(/\/$/, "") || "/";
  if (pathname.startsWith("/control/v1") && !session) {
    return Response.json(
      { error: { code: "unauthorized", message: "Authentication required." } },
      {
        status: 401,
        headers: { "cache-control": "no-store" },
      },
    );
  }
  if (pathname === "/login" && session) {
    const returnTo = sanitizeReturnTo(context.url.searchParams.get("returnTo"));
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "private, no-store",
        location: returnTo === "/login" ? "/" : returnTo,
        vary: "Cookie",
      },
    });
  }

  if (PROTECTED_PATHS.has(pathname) && !session) {
    const returnTo = `${pathname}${context.url.search}`;
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        location: `/login?returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
  }

  const response = await next();
  if (session) {
    response.headers.set("cache-control", "private, no-store");
    response.headers.append("vary", "Cookie");
  }
  return response;
};
