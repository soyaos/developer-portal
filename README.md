<p align="center">
  <img src="public/logo.jpg" alt="SoyaOS" width="120" height="120" />
</p>

# developer-portal

> [!WARNING]
> **开发中，尚未正式发布（Development Preview — Not Released）**
>
> 本项目仍在积极开发，功能和接口尚未稳定，随时可能发生不向后兼容的
> breaking changes。请勿将当前版本用于生产环境，也不要依赖现有 API、
> 配置格式或行为保持不变。
>
> This project is under active development and has not been officially
> released. Features and interfaces are unstable and may introduce breaking
> changes without notice. Do not use the current version in production or
> rely on existing APIs, configuration formats, or behavior remaining stable.

Source for **[developer.soyaos.ai](https://developer.soyaos.ai)** — the
SoyaOS Developer Portal.

It hosts four surfaces that all share a single Astro + React + Tailwind
codebase:

| Surface              | Path                | Status (alpha) |
| -------------------- | ------------------- | -------------- |
| API Reference        | `/docs`             | iframe to docs.soyaos.ai |
| API Keys             | `/api-keys`         | placeholder    |
| Webhook Debugger     | `/webhook-debugger` | placeholder    |
| Usage Dashboard      | `/usage`            | placeholder    |

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
   ```
   Generate the last value with `openssl rand -base64 48` and paste its output
   after `SESSION_SECRET=`.
4. Restart `npm run dev`. Click **Sign in** → **Continue with GitHub**.

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
- Custom domain: `developer.soyaos.ai`.
- Runtime: `@astrojs/cloudflare` on Workers.

## Alpha mock banner

Every page in this portal shows a yellow `Alpha preview` banner at the
top of the layout (`src/layouts/Base.astro`). It is gated by
`import.meta.env.PUBLIC_ALPHA_MOCK`; the CI deploy workflow sets it to
`"true"`. Once the control plane RPC is wired in EPIC 6 and the portal
is no longer serving mock data, flip the env var to `"false"` (or
remove it from `.github/workflows/deploy.yml`) and the banner
disappears.

Tracking checklist for "stop being mock":

- `/api-keys` → wire `POST /control/v0/auth/keys`
- `/webhook-debugger` → subscribe to `webhook.event.v1` over WS
- `/usage` → call `GET /control/v0/usage`
- Banner stays until **all three** land.

## Deploy

`main` is auto-deployed to the Cloudflare Worker
`soyaos-developer-portal` by `.github/workflows/deploy.yml` on every
push. The custom domain `developer.soyaos.ai` is bound to that Worker.

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret                  | Notes                                                     |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Workers Scripts:Edit (least privilege).                   |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that owns the Worker.                  |

Required **Cloudflare Worker secrets** (not GitHub Actions
secrets), configured on `soyaos-developer-portal` under **Settings →
Variables and Secrets**:

| Secret                       | Notes                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `GITHUB_OAUTH_CLIENT_ID`     | Client ID for the production GitHub OAuth App.             |
| `GITHUB_OAUTH_CLIENT_SECRET` | Encrypted OAuth client secret; never exposed to the client. |
| `SESSION_SECRET`             | At least 32 random bytes; rotation invalidates sessions.   |

The session cookie is named `__Host-soyaos_session` and is AES-GCM encrypted
with a 12-hour maximum lifetime. It is issued with `HttpOnly`, `Secure`,
`SameSite=Lax`, and `Path=/`.

Optional: set repository variable `PUBLIC_ALPHA_MOCK=false` (or edit
the workflow) once the real control plane is wired in.

## License

[MIT](./LICENSE) — © 2026 SoyaOS Contributors.
