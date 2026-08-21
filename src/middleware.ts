import type { MiddlewareHandler } from "astro";
import { sanitizeReturnTo } from "./lib/github-oauth";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizePath,
  negotiateLocale,
  stripLocale,
  UNSUPPORTED_LOCALE_SEGMENTS,
} from "./lib/i18n";
import { runtimeEnv } from "./lib/runtime-env";
import { clearSession, getSession } from "./lib/session";

const PROTECTED_PATHS = new Set([
  "/api-keys",
  "/playground",
  "/usage",
  "/webhook-debugger",
]);

const USER_PAGE_PATHS = new Set([
  "/",
  "/docs",
  "/login",
  "/terms",
  "/privacy",
  ...PROTECTED_PATHS,
]);

const DISCOVERY_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);
const STATIC_PATH = /^\/(?:_astro\/|favicon\.|logo\.)/;

function notFound(): Response {
  return new Response("Not found.", {
    status: 404,
    headers: { "cache-control": "public, max-age=60" },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "public, max-age=300",
      location,
    },
  });
}

function withQuery(pathname: string, url: URL): string {
  return `${pathname}${url.search}`;
}

export const onRequest: MiddlewareHandler = async (context, next) => {
  const hostname = context.url.hostname.toLowerCase();
  const rawPathname = context.url.pathname.replace(/\/$/, "") || "/";
  context.locals.locale = DEFAULT_LOCALE;
  context.locals.publicPath = context.url.pathname;

  if (hostname === "cloud.soyaos.ai") {
    return redirect(`https://developer.soyaos.ai${context.url.pathname}${context.url.search}`);
  }

  if (hostname === "status.soyaos.ai") {
    if (rawPathname === "/") {
      return redirect(`/${negotiateLocale(context.request.headers.get("accept-language"))}`);
    }
    const segment = rawPathname.slice(1);
    if (!isLocale(segment)) return notFound();
    context.locals.locale = segment;
    return next("/status");
  }

  const bypassLocale =
    hostname === "api.soyaos.ai" ||
    rawPathname.startsWith("/auth/") ||
    rawPathname.startsWith("/control/") ||
    rawPathname.startsWith("/v1/") ||
    DISCOVERY_PATHS.has(rawPathname) ||
    STATIC_PATH.test(rawPathname);

  let pathname = rawPathname;
  let rewriteTarget: string | undefined;
  const markdownMatch = rawPathname.match(
    /^\/(zh|zh-hant|en)(?:\/(docs|terms|privacy))?\.md$/,
  );

  if (markdownMatch && isLocale(markdownMatch[1])) {
    context.locals.locale = markdownMatch[1];
  } else if (!bypassLocale) {
    const firstSegment = rawPathname.split("/")[1] ?? "";
    if (UNSUPPORTED_LOCALE_SEGMENTS.has(firstSegment.toLowerCase())) return notFound();

    if (isLocale(firstSegment)) {
      context.locals.locale = firstSegment;
      pathname = stripLocale(rawPathname, firstSegment).replace(/\/$/, "") || "/";
      if (!USER_PAGE_PATHS.has(pathname)) return notFound();
      rewriteTarget = withQuery(pathname, context.url);
    } else if (USER_PAGE_PATHS.has(rawPathname)) {
      const locale = negotiateLocale(context.request.headers.get("accept-language"));
      return redirect(withQuery(localizePath(locale, rawPathname), context.url));
    }
  }

  const secret = runtimeEnv().SESSION_SECRET?.trim() ?? "";
  const session = secret ? await getSession(context.cookies, secret) : null;
  context.locals.user = session;

  if (context.cookies.has("__Host-soyaos_session") && !session) {
    clearSession(context.cookies);
  }

  if (pathname.startsWith("/control/v1") && !session) {
    return Response.json(
      { error: { code: "unauthorized", message: "Authentication required." } },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  if (pathname === "/login" && session) {
    const fallback = `/${context.locals.locale}`;
    const returnTo = sanitizeReturnTo(context.url.searchParams.get("returnTo"), fallback);
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "private, no-store",
        location: returnTo === localizePath(context.locals.locale, "/login") ? fallback : returnTo,
        vary: "Cookie",
      },
    });
  }

  if (PROTECTED_PATHS.has(pathname) && !session) {
    const returnTo = withQuery(localizePath(context.locals.locale, pathname), context.url);
    const login = localizePath(context.locals.locale, "/login");
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "no-store",
        location: `${login}?returnTo=${encodeURIComponent(returnTo)}`,
      },
    });
  }

  const response = await next(rewriteTarget);
  response.headers.set("content-language", context.locals.locale);
  if (session) {
    response.headers.set("cache-control", "private, no-store");
    response.headers.append("vary", "Cookie");
  }
  if (hostname === "developer-staging.soyaos.ai") {
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
};
