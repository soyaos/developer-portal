<p align="center">
  <img src="public/logo.png" alt="SoyaOS" width="120" height="120" />
</p>

# developer-portal

Source for **[developer.soyaos.ai](https://developer.soyaos.ai)** — the
SoyaOS Developer Portal.

It hosts five surfaces that all share a single Astro + React + Tailwind
codebase:

| Surface              | Path                | Status (alpha) |
| -------------------- | ------------------- | -------------- |
| API Reference        | `/docs`             | iframe to docs.soyaos.ai |
| Playground           | `/playground`       | placeholder    |
| API Keys             | `/keys`             | placeholder    |
| Webhook Debugger     | `/webhooks`         | placeholder    |
| Usage Dashboard      | `/usage`            | placeholder    |

## Stack

- [Astro 5](https://astro.build) — static-first with island hydration.
- [React 18](https://react.dev) — used inside Astro islands for the
  Playground, Keys, Webhooks and Usage interactive UIs.
- [Tailwind CSS](https://tailwindcss.com) — utility classes; the
  `Soya / stone-ground warmth` palette is wired in `tailwind.config.mjs`.
- shadcn/ui — added per-component as the dashboards land.
- [Bun](https://bun.sh) — preferred dev runtime; fall back to `npm` is fine.

## Local dev

```bash
# Bun (preferred)
bun install
bun run dev

# or, if Bun isn't available
npm install
npm run dev
```

Then open <http://localhost:4321>.

## Auth Setup

The portal signs developers in with GitHub OAuth. To run the flow
end-to-end locally:

1. Visit <https://github.com/settings/developers> and create a new
   **OAuth App** (not a GitHub App). Use:
   - Homepage URL: `http://localhost:4321`
   - Authorization callback URL: `http://localhost:4321/auth/github/callback`
2. Copy the generated **Client ID** and **Client secret**.
3. `cp .env.example .env.local` and fill in:
   ```env
   PUBLIC_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
   GITHUB_CLIENT_SECRET=ghp_xxxxxxxxxxxxxxxxxxxx
   ```
4. Restart `bun run dev`. Click **Sign in** → **Continue with GitHub**.

During alpha the callback handler mocks the control-plane exchange and
issues a fake session token cookie (`soyaos_session`, httpOnly + secure).
The TODO in `src/pages/auth/github/callback.astro` shows exactly where to
plug in the real `POST /control/v0/auth/github/exchange` call. SAML SSO
ships with the enterprise edition.

## 中文 Quickstart

SoyaOS 开发者门户的源码。使用 Astro 5 + React + Tailwind 构建，部署到
Cloudflare Pages。本地开发：

```bash
bun install
bun run dev      # 等价于 npm install && npm run dev
```

构建产物在 `dist/`，可直接给 Cloudflare Pages / Vercel / 静态托管。

## Deployment

Production is deployed to **Cloudflare Pages**:

- Build command: `bun run build` (or `npm run build`).
- Output directory: `dist/`.
- Custom domain: `developer.soyaos.ai`.

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

`main` is auto-deployed to the Cloudflare Pages project
`soyaos-developer-portal` by `.github/workflows/deploy.yml` on every
push. The custom domain `developer.soyaos.ai` is bound to that Pages
project via the Cloudflare dashboard (CNAME `developer` →
`soyaos-developer-portal.pages.dev`, "Always Use HTTPS" enabled).

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret                  | Notes                                                     |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Pages:Edit (least privilege).                             |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that owns the Pages project.           |

Optional: set repository variable `PUBLIC_ALPHA_MOCK=false` (or edit
the workflow) once the real control plane is wired in.

## License

[MIT](./LICENSE) — © 2026 SoyaOS Contributors.
