import type { APIRoute } from "astro";
import { isLocale } from "../lib/i18n";
import { markdownResponse } from "../lib/public-content";

export const prerender = false;

export const GET: APIRoute = ({ params }) => {
  const locale = params.locale;
  if (!isLocale(locale)) return new Response("Not found.", { status: 404 });
  return markdownResponse(locale, "");
};
