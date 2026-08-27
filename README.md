<p align="center">
  <img src="public/logo.jpg" alt="SoyaOS" width="120" height="120" />
</p>

# developer-portal

> [!NOTE]
> **v0.2.0 Stable**
>
> 免费、单区域、best-effort、无 SLA。v0.2.0 的公开合同保持稳定；后续破坏性
> 变更需要新的版本，不建议承载关键生产或受监管工作负载。
>
> Free single-region stable release, best effort, no SLA. Breaking contract
> changes require a later version; do not use it for critical or regulated workloads.

Source for **[developer.soyaos.ai](https://developer.soyaos.ai)** — the
SoyaOS Developer Portal.

It hosts four surfaces that all share a single Astro + React + Tailwind
codebase:

| Surface              | Path                | Status (v0.2.0) |
| -------------------- | ------------------- | -------------- |
| API Reference        | `/docs`       | iframe to docs.soyaos.ai |
| Playground           | `/playground` | live browser inference   |
| API Keys             | `/api-keys`   | D1-backed                |
| Usage and Traces     | `/usage`      | D1-backed metadata       |

## Stack

- [Astro 7](https://astro.build) — Cloudflare SSR with island hydration.
- [React 18](https://react.dev) — used inside Astro islands for the
  Keys, Webhooks and Usage interactive UIs.
- [Tailwind CSS 4](https://tailwindcss.com) — utility classes with the
  `Soya / stone-ground warmth` theme in `src/styles/globals.css`.
- shadcn/ui — added per-component as the dashboards land.
- Node.js 22.12 or newer; CI and production builds use Node.js 24.

## Local dev

```bash
npm ci
npm run dev
```

Then open <http://localhost:4321>.

## Auth Setup

The portal signs developers in with GitHub OAuth from Cloudflare Workers SSR.
The GitHub access token exists only while the callback fetches `/user`; the
browser receives an encrypted, authenticated session cookie instead.

To run the flow end-to-end locally, create a separate development OAuth App:

1. Visit <https://github.com/settings/developers> and create a new
   **OAuth App** (not a GitHub App). Use:
   - Homepage URL: `http://localhost:4321`
   - Authorization callback URL: `http://localhost:4321/auth/github/callback`
2. Copy the generated **Client ID** and **Client secret**.
3. Create the ignored Cloudflare local-secret file and fill in its values:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   ```dotenv
   GITHUB_OAUTH_CLIENT_ID=your-client-id
   GITHUB_OAUTH_CLIENT_SECRET=your-client-secret
   SESSION_SECRET=the-output-from-openssl-rand-base64-48
   API_KEY_PEPPER=another-independent-random-48-byte-value
   ```
   Generate the last value with `openssl rand -base64 48` and paste its output
   after `SESSION_SECRET=`.
4. Apply the local D1 schema, then start the portal:
   ```bash
   npx wrangler d1 migrations apply soyaos-cloud-preview --local
   npm run dev
   ```
   Click **Sign in** → **Continue with GitHub**.

Do not reuse the production OAuth App for localhost: its registered callback
is `https://developer.soyaos.ai/auth/github/callback`. Unit tests mock GitHub
HTTP responses and do not require real credentials. SAML SSO ships with the
enterprise edition.

## 中文 Quickstart

SoyaOS 开发者门户的源码。使用 Astro 7 + React + Tailwind 4 构建，部署到
Cloudflare Workers。本地开发：

```bash
npm ci
npm run dev
```

构建产物在 `dist/`，包含 Cloudflare Worker 与静态 assets。

## Deployment

Production is deployed to **Cloudflare Workers**:

- Build command: `npm run build`.
- Output directory: `dist/`.
- Custom domains: `developer.soyaos.ai` and `api.soyaos.ai`.
- Runtime: `@astrojs/cloudflare` on Workers.

Staging uses separate Cloudflare resources:

- Worker: `soyaos-developer-portal-staging`.
- D1: `soyaos-cloud-preview-staging`.
- Custom domains: `developer-staging.soyaos.ai` and `api-staging.soyaos.ai`.
- Build and deploy: `npm run deploy:staging`; migrate:
  `npm run d1:migrate:staging`.

The staging build sets `CLOUDFLARE_ENV=staging` so Astro's generated deploy
configuration keeps the staging Worker name, domains, and bindings. Wrangler
bindings and vars are intentionally repeated under `env.staging`
because environment-specific bindings are not inherited. Staging and
production must never share D1, OAuth credentials, `SESSION_SECRET`, or
`API_KEY_PEPPER`.

## Cloud inference API

SoyaOS Cloud v0.2.0 exposes an OpenAI-compatible subset at
`https://api.soyaos.ai`. Create an API key in the Developer Portal, then run:

```bash
export SOYAOS_API_KEY='YOUR_API_KEY'
curl https://api.soyaos.ai/v1/chat/completions \
  --header "Authorization: Bearer ${SOYAOS_API_KEY}" \
  --header 'Content-Type: application/json' \
  --data '{"model":"soya:starter","messages":[{"role":"user","content":"Reply with: cloud ready"}]}'
```

Supported endpoints are `GET /v1/models` and
`POST /v1/chat/completions`. The public `soya:starter` alias is backed by a
Workers AI model without exposing the provider model ID. Streaming uses
OpenAI-style server-sent events and terminates with `data: [DONE]`.

Free v0.2.0 quotas are enforced per tenant in D1: 20 requests/minute, two
concurrent requests, 100 requests/day, and 100,000 reserved tokens/day.
Responses include `x-request-id`; quota errors also include `retry-after`.
Prompt and completion bodies are never persisted.

## Cloud control plane

The authenticated control plane uses one D1 database with strict
`tenant_id` filters. Each GitHub numeric ID maps to one personal tenant.

- API keys are opaque strings shown once. External callers must not parse,
  validate, or depend on their prefix, length, or internal structure.
- D1 stores only an HMAC-SHA-256 digest derived with `API_KEY_PEPPER`.
- A tenant can keep at most three active keys.
- Usage and trace metadata is retained for 24 hours; prompt and response
  bodies are not stored.
- Migrations live in `migrations/`. GitHub Actions applies pending remote
  migrations before publishing a Worker version that depends on them.
- `CLOUDFLARE_API_TOKEN` uses the existing Cloudflare token
  `soyaos-developer-portal-ci`. If CI later reports a missing Cloudflare
  permission, add the least-privilege permission to that token, then overwrite
  the existing GitHub repository secret. Do not create a duplicate token or
  secret name unless credentials are being deliberately rotated.

## Deploy

`main` is auto-deployed to the Cloudflare Worker
`soyaos-developer-portal` by `.github/workflows/deploy.yml` on every
push. The custom domain `developer.soyaos.ai` is bound to that Worker.

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret                  | Notes                                                     |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Existing `soyaos-developer-portal-ci` token: Workers Scripts Edit and D1 Edit. Extend this token with least privilege when CI needs another scoped permission. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that owns the Worker.                  |

Required **Cloudflare Worker secrets** (not GitHub Actions
secrets), configured on `soyaos-developer-portal` under **Settings →
Variables and Secrets**:

| Secret                       | Notes                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `GITHUB_OAUTH_CLIENT_ID`     | Client ID for the production GitHub OAuth App.             |
| `GITHUB_OAUTH_CLIENT_SECRET` | Encrypted OAuth client secret; never exposed to the client. |
| `SESSION_SECRET`             | At least 32 random bytes; rotation invalidates sessions.   |
| `API_KEY_PEPPER`             | At least 32 random bytes; rotation invalidates API keys.   |

The staging Worker uses the same four secret names with independent values,
plus `E2E_BOOTSTRAP_SECRET`. The latter protects
`POST /auth/e2e/session`, which accepts only the fixed `tenant-a` and
`tenant-b` synthetic identities. The similarly protected
`POST /auth/e2e/reset` route can reset those tenants between runs or expire
their metadata for retention tests. Both routes return `404` unless
`DEPLOYMENT_ENV` is exactly `staging`, including when the secret is
accidentally configured on production. Never print the bootstrap secret,
session cookie, or generated API keys in E2E logs or reports.

## Production release preflight

After every production publish, CI runs a read-only preflight against the
public contract surfaces. It verifies the Portal pages, anonymous API error
envelope, the `cloud.soyaos.ai` canonical redirect, the public status page and
that staging-only E2E routes remain hidden in production:

```bash
npm run preflight:production
```

The production secret-name check reads names only and fails if a required name
is missing or if `E2E_BOOTSTRAP_SECRET` appears in production. It never reads or
prints secret values:

```bash
npm run preflight:production:secrets
```

Before a release, run the dependency and redacted Git-history scan locally:

```bash
npm run security:audit
```

GitHub OAuth also uses a separate staging OAuth App with callback
`https://developer-staging.soyaos.ai/auth/github/callback`. Store its Client ID
and Client Secret directly as encrypted staging Worker secrets; never commit
them or place them in GitHub Actions logs.

The session cookie is named `__Host-soyaos_session` and is AES-GCM encrypted
with a 12-hour maximum lifetime. It is issued with `HttpOnly`, `Secure`,
`SameSite=Lax`, and `Path=/`.

## License

[MIT](./LICENSE) — © 2026 SoyaOS Contributors.
