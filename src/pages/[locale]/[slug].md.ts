import type { APIRoute } from "astro";
import { isLocale } from "../../lib/i18n";
import {
  markdownResponse,
  type PublicContentSlug,
} from "../../lib/public-content";

export const prerender = false;

const SLUGS = new Set<PublicContentSlug>(["docs", "terms", "privacy"]);

export const GET: APIRoute = ({ params }) => {
  const locale = params.locale;
  const slug = params.slug as PublicContentSlug | undefined;
  if (!isLocale(locale) || !slug || !SLUGS.has(slug)) {
    return new Response("Not found.", { status: 404 });
  }
  return markdownResponse(locale, slug);
};
