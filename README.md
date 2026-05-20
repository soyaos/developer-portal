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

## License

[MIT](./LICENSE) — © 2026 SoyaOS Contributors.
