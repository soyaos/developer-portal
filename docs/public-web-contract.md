# SoyaOS public web contract

Status: approved for implementation on 2026-08-21 by APP-1827 option ②.

This contract is the single review checklist for APP-1828 through APP-1832. It
applies to the public SoyaOS web properties and separates human-facing HTML,
agent-facing Markdown, authenticated application routes, and API surfaces.

## 1. Locale contract

| Internal code / URL segment | HTML / hreflang | Open Graph | Native name |
| --- | --- | --- | --- |
| `zh` | `zh-CN` | `zh_CN` | 简体中文 |
| `zh-hant` | `zh-Hant` | `zh_TW` | 繁體中文 |
| `en` | `en-US` | `en_US` | English |

- Every localized user-facing HTML URL includes a locale segment.
- The URL is the only locale source after navigation. No locale cookie or
  `localStorage` key is written.
- A locale-less user page returns `302` to the same path under a locale:
  - missing, empty, or wildcard-only `Accept-Language` -> `zh`;
  - a supported preference -> the first supported locale by quality order;
  - valid preferences with no supported locale -> `en`.
- `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant-*` map to `zh-hant`.
- `zh`, `zh-CN`, `zh-SG`, and `zh-Hans-*` map to `zh`.
- `en-*` maps to `en`.
- `/zh-cn/**`, `/zh-Hans/**`, `/zh-tw/**`, and other unsupported locale
  segments return `404`; they are not compatibility redirects.
- The locale switcher replaces only the locale segment and preserves the
  pathname, query string, and fragment.

## 2. Canonical content ownership

| Hostname | Role | Canonical/indexing policy |
| --- | --- | --- |
| `soyaos.ai` | Marketing and canonical SoyaOS documentation | Index localized HTML. The existing three-locale Markdown collection owns documentation content. |
| `docs.soyaos.ai` | Legacy documentation alias | Redirect old and locale-aware document paths to `https://soyaos.ai/<locale>/docs/...`; do not index duplicate HTML. |
| `developer.soyaos.ai` | Developer Portal and Cloud account application | Index localized editorial HTML. Mark login and authenticated/transactional pages `noindex`. |
| `status.soyaos.ai` | Public operational status | Serve localized status HTML. It is not part of the Markdown alternate scope. |
| `cloud.soyaos.ai` | Product alias | Preserve the path and redirect to `developer.soyaos.ai`; do not own indexed content. |
| `api.soyaos.ai` | OpenAI-compatible API | Never index API responses. Discovery files point agents to canonical documentation. |
| `developer-staging.soyaos.ai` | Staging | `Disallow: /` and `X-Robots-Tag: noindex, nofollow` on every response. |

## 3. Localized route classes

### `soyaos.ai`

| URL shape | Visibility | Markdown alternate |
| --- | --- | --- |
| `/<locale>` | indexable editorial | `/<locale>.md` |
| `/<locale>/editions` | indexable editorial | `/<locale>/editions.md` |
| `/<locale>/pricing` | indexable editorial | `/<locale>/pricing.md` |
| `/<locale>/docs` | indexable editorial | `/<locale>/docs.md` |
| `/<locale>/docs/<slug>` | indexable documentation | `/<locale>/docs/<slug>.md` |

### `developer.soyaos.ai`

| URL shape | Visibility | Markdown alternate |
| --- | --- | --- |
| `/<locale>` | indexable editorial | `/<locale>.md` |
| `/<locale>/docs` | indexable editorial navigation | `/<locale>/docs.md` |
| `/<locale>/terms` | indexable editorial/legal | `/<locale>/terms.md` |
| `/<locale>/privacy` | indexable editorial/legal | `/<locale>/privacy.md` |
| `/<locale>/login` | public but `noindex` | none |
| `/<locale>/api-keys` | authentication required, `noindex` | none |
| `/<locale>/playground` | authentication required, `noindex` | none |
| `/<locale>/usage` | authentication required, `noindex` | none |
| `/<locale>/webhook-debugger` | authentication required, `noindex` | none |
| `/auth/**` | OAuth/session transport, `noindex` | none |
| `/control/**` | authenticated JSON API, never index | none |
| `/v1/**` | API surface, never index | none |

`status.soyaos.ai` uses `/<locale>` status pages and negotiates `/` with the
same locale algorithm. `cloud.soyaos.ai` preserves localized paths while
redirecting them to `developer.soyaos.ai`.

The hostname root `/` is the only public HTML URL that ends in `/`. Every
localized HTML URL is slashless. A legacy trailing-slash request receives one
permanent redirect to the slashless form with its query string preserved;
file-like discovery and Markdown paths are never rewritten by this rule.

## 4. HTML representation

Every indexable HTML response:

- is server-rendered with its primary text present without client JavaScript;
- sets `<html lang>` to the mapped BCP-47 value;
- has a unique localized title and description;
- emits an absolute self-referencing canonical URL;
- emits reciprocal `hreflang` alternates for `zh-CN`, `zh-Hant`, `en-US`, and
  `x-default` pointing to the `zh` URL;
- emits Open Graph and Twitter metadata;
- emits truthful JSON-LD (`WebSite`, `WebPage`, `TechArticle`, or the closest
  applicable schema type);
- emits `<link rel="alternate" type="text/markdown" href="...">` only when
  the declared Markdown URL exists;
- is included in the owning hostname's sitemap only if it returns `200` and
  is the canonical HTML representation.

Authenticated, login, and staging HTML responses emit `noindex`; they are not
included in sitemaps or `llms.txt`.

## 5. Markdown representation

Only the routes listed in section 3 receive a Markdown alternate. HTML and
Markdown load the same content entry or typed public-content record.

Required response headers:

```http
Content-Type: text/markdown; charset=utf-8
Content-Disposition: inline
X-Robots-Tag: noindex
Link: <https://canonical-html.example/path>; rel="canonical"
Cache-Control: public, max-age=300
```

Markdown URLs:

- return UTF-8 Markdown containing the same title, summary, and material facts
  as the HTML page;
- include a short canonical/source pointer for agents;
- remain crawlable but are excluded from XML sitemaps;
- never include user, session, API key, quota, prompt, response, or trace data;
- return `404` when the locale/content entry does not exist;
- do not exist for dynamic, login, authenticated, control-plane, or inference
  routes.

There is no `/llm.txt` compatibility path. The only site index name is
`/llms.txt`.

## 6. Discovery endpoints

Content-owning hosts provide:

- `/robots.txt`: explicit crawl rules plus an absolute `Sitemap:` line;
- `/sitemap.xml`: canonical HTML only, with reciprocal locale alternates and
  `lastmod` where a source date exists;
- `/llms.txt`: a concise Markdown overview linking to public `.md` alternates.

Redirect-only hosts preserve or redirect these discovery entry points to the
canonical owner. `api.soyaos.ai` disallows API crawling and exposes
`/llms.txt` only as a pointer to the public API documentation; its sitemap
entry redirects to the canonical content sitemap.

Public content is allowed for verified search and agent crawlers including
Googlebot, OAI-SearchBot, ChatGPT-User, GPTBot, ClaudeBot,
Claude-SearchBot, Claude-User, PerplexityBot, and Perplexity-User. Application
authentication remains mandatory; crawler identity never bypasses access
control.

Cloudflare AI Crawl Control, Managed robots, Block AI bots, and WAF behavior
must agree with the repository responses. A successful origin response is not
sufficient if the edge returns a challenge or `403` to an allowed crawler.

## 7. Release gates

- Locale unit tests cover mapping, quality ordering, two fallback cases, and
  invalid locale paths.
- Dictionary keys are structurally identical for all three locales.
- HTML tests validate canonical, reciprocal hreflang, language, metadata,
  JSON-LD, and real Markdown alternates.
- Markdown tests validate content type, canonical Link, noindex, and parity
  with the corresponding content record.
- Discovery tests parse robots, sitemap, and `llms.txt`, request every listed
  URL, and reject private/noindex/redirect URLs in the sitemap.
- URL-shape tests reject trailing slashes in canonical/hreflang/sitemap URLs
  and verify one permanent redirect from each legacy HTML form.
- Browser E2E validates the dropdown, keyboard controls, current-locale state,
  and preservation of path/query/fragment.
- Staging passes the full public-web suite before production deployment.
- Production smoke is read-only: it does not log in, create keys, or call Chat.
- Relevant repositories are committed, pushed, and clean; CI/deployment and
  production smoke evidence is linked from APP-1832.

## References

- `/Users/zealot/workspace/appforges/site/docs/system-design/i18n/guidelines.md`
- `/Users/zealot/workspace/soyaos/website/src/i18n/config.ts`
- `/Users/zealot/workspace/soyaos/website/src/content.config.ts`
- `/Users/zealot/workspace/soyaos/developer-portal/src/middleware.ts`
- `/Users/zealot/workspace/soyaos/docs/docusaurus.config.ts`
- <https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites>
- <https://help.openai.com/en/articles/12627856-publishers-and-developers-faq>
- <https://developers.cloudflare.com/ai-crawl-control/reference/bots/>
- <https://llmstxt.org/>
