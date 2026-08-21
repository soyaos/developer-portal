import { describe, expect, it } from "vitest";
import { llmsResponse, robotsResponse, sitemapResponse } from "../src/lib/discovery";

describe("public discovery endpoints", () => {
  it("lists only the 12 canonical portal HTML pages with reciprocal locales", async () => {
    const response = sitemapResponse("developer.soyaos.ai");
    const body = await response.text();
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect([...body.matchAll(/<loc>([^<]+)<\/loc>/g)]).toHaveLength(12);
    expect(body.match(/hreflang="zh-CN"/g)).toHaveLength(12);
    expect(body.match(/hreflang="zh-Hant"/g)).toHaveLength(12);
    expect(body.match(/hreflang="en-US"/g)).toHaveLength(12);
    expect(body.match(/hreflang="x-default"/g)).toHaveLength(12);
    expect(body).not.toContain(".md</loc>");
    expect(body).not.toContain("login");
  });

  it("publishes the same 12 portal records through llms.txt", async () => {
    const response = llmsResponse("developer.soyaos.ai");
    const body = await response.text();
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(body.match(/https:\/\/developer\.soyaos\.ai\/[^)]+\.md/g)).toHaveLength(12);
  });

  it("keeps API discovery out of the API surface", async () => {
    expect(await robotsResponse("api.soyaos.ai").text()).toContain("Disallow: /\nAllow: /llms.txt");
    expect(sitemapResponse("api.soyaos.ai")).toMatchObject({ status: 308 });
    expect(sitemapResponse("api.soyaos.ai").headers.get("location")).toBe("https://soyaos.ai/sitemap.xml");
    expect(await llmsResponse("api.soyaos.ai").text()).toContain("https://soyaos.ai/en/docs/http-api.md");
  });

  it("disallows every staging route and exposes no staging index", async () => {
    expect(await robotsResponse("developer-staging.soyaos.ai").text()).toBe("User-agent: *\nDisallow: /\n");
    expect(sitemapResponse("developer-staging.soyaos.ai").status).toBe(404);
    expect(llmsResponse("api-staging.soyaos.ai").status).toBe(404);
  });

  it("publishes a three-locale status sitemap without Markdown alternates", async () => {
    const body = await sitemapResponse("status.soyaos.ai").text();
    expect([...body.matchAll(/<loc>([^<]+)<\/loc>/g)]).toHaveLength(3);
    expect(body).not.toContain(".md");
    expect(await llmsResponse("status.soyaos.ai").text()).toContain("https://status.soyaos.ai/zh-hant");
  });
});
