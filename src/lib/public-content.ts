import { getDictionary, type Locale } from "./i18n";

export type PublicContentSlug = "" | "docs" | "terms" | "privacy";

export interface PublicContent {
  slug: PublicContentSlug;
  title: string;
  description: string;
  schemaType: "WebSite" | "WebPage";
  markdown: string;
}

function sections(items: Array<{ title: string; body: string }>): string {
  return items.map((item) => `## ${item.title}\n\n${item.body}`).join("\n\n");
}

export function getPublicContent(locale: Locale, slug: PublicContentSlug): PublicContent {
  const dictionary = getDictionary(locale);
  if (slug === "") {
    const cards = dictionary.home.cards
      .map((card) => `## ${card.title}\n\n${card.body}`)
      .join("\n\n");
    return {
      slug,
      title: dictionary.home.title,
      description: dictionary.home.description,
      schemaType: "WebSite",
      markdown: `# ${dictionary.home.title}\n\n${dictionary.home.description}\n\n${cards}`,
    };
  }
  if (slug === "docs") {
    return {
      slug,
      title: dictionary.docs.heading,
      description: dictionary.docs.description,
      schemaType: "WebPage",
      markdown: `# ${dictionary.docs.heading}\n\n${dictionary.docs.description}\n\n[${dictionary.docs.openDocs}](https://soyaos.ai/${locale}/docs)`,
    };
  }
  if (slug === "terms") {
    return {
      slug,
      title: dictionary.terms.heading,
      description: dictionary.terms.effective,
      schemaType: "WebPage",
      markdown: `# ${dictionary.terms.heading}\n\n${dictionary.terms.effective}\n\n${sections(dictionary.terms.sections)}\n\n${dictionary.terms.note}`,
    };
  }
  return {
    slug,
    title: dictionary.privacy.heading,
    description: dictionary.privacy.effective,
    schemaType: "WebPage",
    markdown: [
      `# ${dictionary.privacy.heading}`,
      dictionary.privacy.effective,
      `## ${dictionary.privacy.keepsTitle}\n\n${dictionary.privacy.keeps.map((item) => `- ${item}`).join("\n")}`,
      `## ${dictionary.privacy.inferenceTitle}\n\n${dictionary.privacy.inference}`,
      `## ${dictionary.privacy.locationTitle}\n\n${dictionary.privacy.location}`,
      dictionary.privacy.note,
    ].join("\n\n"),
  };
}

export function publicHtmlPath(locale: Locale, slug: PublicContentSlug): string {
  return slug ? `/${locale}/${slug}` : `/${locale}`;
}

export function publicMarkdownPath(locale: Locale, slug: PublicContentSlug): string {
  return `${publicHtmlPath(locale, slug)}.md`;
}

export function markdownResponse(locale: Locale, slug: PublicContentSlug): Response {
  const content = getPublicContent(locale, slug);
  const canonical = `https://developer.soyaos.ai${publicHtmlPath(locale, slug)}`;
  const body = `${content.markdown.trim()}\n\n---\n\nCanonical HTML: ${canonical}\n`;
  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": "inline",
      "content-type": "text/markdown; charset=utf-8",
      link: `<${canonical}>; rel="canonical"`,
      "x-robots-tag": "noindex",
    },
  });
}
