# Changelog

All notable changes to the Developer Portal will be documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this site adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub OAuth scaffold: `/auth/github/start` and `/auth/github/callback`
  pages, plus a `src/lib/session.ts` helper that reads / writes the
  `soyaos_session` httpOnly cookie. `.env.example` documents the required
  `PUBLIC_GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` variables.
- `/login` now points the GitHub button at the real start page and
  reserves a SAML SSO slot for enterprise editions.
- `/api-keys` surface: list / create / revoke API keys with mock data,
  one-time raw-key reveal dialog, and per-key scope checkboxes. Adds the
  first batch of in-house shadcn/ui primitives (`button`, `card`,
  `input`, `badge`, `dialog`, plus a `cn` helper) under
  `src/components/ui/`.
- `/webhook-debugger` surface: live inbound feed for a selected Channel
  binding (DingTalk / Feishu / WeChat mocks), with raw JSON ↔ canonical
  `Message` split view, Pause/Resume + Clear, and a 100-event LRU buffer.
  Driven by a mock `setInterval`; a TODO points at the real SSE endpoint
  `GET /control/v0/connectors/bindings/{id}/feed`.
- `/usage` surface: per-key &times; agent &times; sandbox-image quota
  dashboard with Today / 7d / 30d tabs, four KPI cards (Calls, vCPU·s,
  GPU·s, Bytes out), a column-sortable breakdown table and an inline
  reminder of the 100ms-granularity billing rule. Adds a `tabs.tsx`
  shadcn primitive. Real wiring placeholder: `GET /control/v0/usage`.

## [0.1.0-alpha.0] — 2026-05-19

### Added

- Initial Astro 5 + React + Tailwind scaffold for the SoyaOS Developer
  Portal, target host `developer.soyaos.ai`.
- Landing page (`/`) with hero "SoyaOS Developer Portal" and five
  placeholder feature cards: API Reference, Playground, API Keys,
  Webhook Debugger, Usage Dashboard.
- `/docs` page that frames `https://docs.soyaos.ai` and prints a
  graceful "docs being prepared" fallback when the iframe fails.
- `/login` placeholder reserving the eventual GitHub Sign-In flow.
- Base layout under `src/layouts/Base.astro` with site nav.
- Tailwind global stylesheet under `src/styles/globals.css`.

[Unreleased]: https://github.com/soyaos/developer-portal/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/soyaos/developer-portal/releases/tag/v0.1.0-alpha.0
