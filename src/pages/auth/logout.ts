import type { APIRoute } from "astro";
import { clearSession } from "../../lib/session";
import { DEFAULT_LOCALE, isLocale } from "../../lib/i18n";

export const prerender = false;

export const POST: APIRoute = async ({ cookies, url }) => {
  clearSession(cookies);
  const requestedLocale = url.searchParams.get("locale") ?? "";
  const locale = isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: `/${locale}/login`,
    },
  });
};
