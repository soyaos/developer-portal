import { describe, expect, it } from "vitest";
import { getDictionary } from "../src/lib/i18n";
import {
  getPublicContent,
  markdownResponse,
  publicHtmlPath,
  publicMarkdownPath,
} from "../src/lib/public-content";

describe("public HTML/Markdown same-source contract", () => {
  it("derives every editorial Markdown representation from the active dictionary", () => {
    const dictionary = getDictionary("zh-hant");
    expect(getPublicContent("zh-hant", "").title).toBe(dictionary.home.title);
    expect(getPublicContent("zh-hant", "docs").markdown).toContain(dictionary.docs.description);
    expect(getPublicContent("zh-hant", "terms").markdown).toContain(
      dictionary.terms.sections[0].body,
    );
    expect(getPublicContent("zh-hant", "privacy").markdown).toContain(
      dictionary.privacy.keeps[0],
    );
  });

  it("builds the approved URL pairs without a /llm.txt compatibility path", () => {
    expect(publicHtmlPath("zh", "")).toBe("/zh");
    expect(publicMarkdownPath("zh", "")).toBe("/zh.md");
    expect(publicHtmlPath("en", "privacy")).toBe("/en/privacy");
    expect(publicMarkdownPath("en", "privacy")).toBe("/en/privacy.md");
  });

  it("returns agent-readable Markdown with canonical and noindex headers", async () => {
    const response = markdownResponse("en", "terms");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("link")).toBe(
      '<https://developer.soyaos.ai/en/terms>; rel="canonical"',
    );
    const body = await response.text();
    expect(body).toContain(`# ${getDictionary("en").terms.heading}`);
    expect(body).toContain("Canonical HTML: https://developer.soyaos.ai/en/terms");
  });
});
