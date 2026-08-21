import { getPublicContent, publicHtmlPath, publicMarkdownPath, type PublicContentSlug } from "./public-content";
import { LOCALES, LOCALE_META, type Locale } from "./i18n";

const PORTAL_ORIGIN = "https://developer.soyaos.ai";
const STATUS_ORIGIN = "https://status.soyaos.ai";
const CANONICAL_DOCS_ORIGIN = "https://soyaos.ai";
const PUBLIC_SLUGS: PublicContentSlug[] = ["", "docs", "terms", "privacy"];

type DiscoveryHost = "portal" | "status" | "api" | "staging";

function hostKind(hostname: string): DiscoveryHost {
  const host = hostname.toLowerCase();
  if (host === "developer-staging.soyaos.ai" || host === "api-staging.soyaos.ai") return "staging";
  if (host === "status.soyaos.ai") return "status";
  if (host === "api.soyaos.ai") return "api";
  return "portal";
}

function textResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": contentType,
    },
  });
}

function notFound(): Response {
  return textResponse("Not found.\n", "text/plain; charset=utf-8", 404);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sitemap(urls: Array<{ locale: Locale; path: string }>, origin: string): string {
  const groupedPaths = [...new Set(urls.map(({ path }) => path))];
  const nodes = urls.map(({ locale, path }) => {
    const alternates = LOCALES.map((candidate) =>
      `    <xhtml:link rel="alternate" hreflang="${LOCALE_META[candidate].htmlLang}" href="${escapeXml(`${origin}${path.replace(`/${locale}`, `/${candidate}`)}`)}" />`,
    );
    alternates.push(
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(`${origin}${path.replace(`/${locale}`, "/zh")}`)}" />`,
    );
    return [
      "  <url>",
      `    <loc>${escapeXml(`${origin}${path}`)}</loc>`,
      ...alternates,
      "  </url>",
    ].join("\n");
  });
  if (groupedPaths.length === 0) throw new Error("sitemap requires localized paths");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...nodes,
    "</urlset>",
    "",
  ].join("\n");
}

export function robotsResponse(hostname: string): Response {
  const kind = hostKind(hostname);
  if (kind === "staging") {
    return textResponse("User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8");
  }
  if (kind === "api") {
    return textResponse([
      "User-agent: *",
      "Disallow: /",
      "Allow: /llms.txt",
      "",
      `Sitemap: ${CANONICAL_DOCS_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n"), "text/plain; charset=utf-8");
  }
  if (kind === "status") {
    return textResponse([
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: ${STATUS_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n"), "text/plain; charset=utf-8");
  }
  return textResponse([
    "User-agent: *",
    "Allow: /",
    "Disallow: /auth/",
    "Disallow: /control/",
    "Disallow: /v1/",
    "Disallow: /*/login",
    "Disallow: /*/api-keys",
    "Disallow: /*/playground",
    "Disallow: /*/usage",
    "Disallow: /*/webhook-debugger",
    "",
    `Sitemap: ${PORTAL_ORIGIN}/sitemap.xml`,
    "",
  ].join("\n"), "text/plain; charset=utf-8");
}

export function sitemapResponse(hostname: string): Response {
  const kind = hostKind(hostname);
  if (kind === "staging") return notFound();
  if (kind === "api") {
    return new Response(null, {
      status: 308,
      headers: {
        "cache-control": "public, max-age=300",
        location: `${CANONICAL_DOCS_ORIGIN}/sitemap.xml`,
      },
    });
  }
  if (kind === "status") {
    return textResponse(
      sitemap(LOCALES.map((locale) => ({ locale, path: `/${locale}` })), STATUS_ORIGIN),
      "application/xml; charset=utf-8",
    );
  }
  const urls = LOCALES.flatMap((locale) =>
    PUBLIC_SLUGS.map((slug) => ({ locale, path: publicHtmlPath(locale, slug) })),
  );
  return textResponse(sitemap(urls, PORTAL_ORIGIN), "application/xml; charset=utf-8");
}

export function llmsResponse(hostname: string): Response {
  const kind = hostKind(hostname);
  if (kind === "staging") return notFound();
  if (kind === "api") {
    const links = LOCALES.map((locale) =>
      `- [${LOCALE_META[locale].nativeName} HTTP API](${CANONICAL_DOCS_ORIGIN}/${locale}/docs/http-api.md)`,
    );
    return textResponse([
      "# SoyaOS API",
      "",
      "The API host is not a documentation origin. Use the canonical public Markdown documentation:",
      "",
      ...links,
      "",
    ].join("\n"), "text/markdown; charset=utf-8");
  }
  if (kind === "status") {
    const links = LOCALES.map((locale) =>
      `- [${LOCALE_META[locale].nativeName} status](${STATUS_ORIGIN}/${locale})`,
    );
    return textResponse([
      "# SoyaOS Cloud Status",
      "",
      "Current public operational status pages:",
      "",
      ...links,
      "",
    ].join("\n"), "text/markdown; charset=utf-8");
  }
  const sections = LOCALES.flatMap((locale) => {
    const links = PUBLIC_SLUGS.map((slug) => {
      const content = getPublicContent(locale, slug);
      return `- [${content.title}](${PORTAL_ORIGIN}${publicMarkdownPath(locale, slug)})`;
    });
    return [`## ${LOCALE_META[locale].nativeName}`, "", ...links, ""];
  });
  return textResponse([
    "# SoyaOS Developer Portal",
    "",
    "Public developer and SoyaOS Cloud account documentation, exposed from the same content records as canonical HTML.",
    "",
    ...sections,
  ].join("\n"), "text/markdown; charset=utf-8");
}
