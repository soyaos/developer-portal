# Changelog

All notable changes to the Developer Portal will be documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this site adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-08-20

### Added

- Real GitHub OAuth with one-shot state cookies, encrypted Portal sessions,
  personal tenants and POST-only logout.
- D1-backed API Key creation, one-time raw-key reveal, HMAC storage, listing
  and revocation with strict tenant isolation.
- OpenAI-compatible `GET /v1/models` and streaming/non-streaming
  `POST /v1/chat/completions` backed by the managed `soya:starter` model.
- Real daily usage and 24-hour request Trace views without storing prompt or
  completion bodies.
- Server-side RPM, concurrency, daily request and daily token limits with
  stable error codes and `Retry-After` guidance.
- A fail-closed D1 operational switch that pauses only new API Key creation
  while existing keys, inference, listing and revocation continue to work.
- Public status page, canonical `cloud.soyaos.ai` redirect, production
  monitoring, controlled inference smoke and sanitized staging E2E gates.

### Changed

- Promoted SoyaOS Cloud from `v0.2.0-preview.1` to the stable `v0.2.0`
  contract while retaining the free, single-region, best-effort, no-SLA
  service boundary.
- Replaced Preview labels in the Portal, service terms, privacy notice,
  status page and operational documentation with the released v0.2.0
  boundary.

### Security

- Production and staging use independent D1 databases, OAuth credentials,
  session secrets, API Key peppers and protected E2E bootstrap routes.
- Logs and reports fail closed on API Keys, Authorization headers, sessions,
  prompts and responses; production preflight confirms staging-only routes
  remain unavailable.
- The v0.2.0 promotion completed ten controlled production Chat calls with
  zero platform errors, revoked the disposable Key, verified HTTP 401, and
  removed the temporary GitHub Environment secret.

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

[Unreleased]: https://github.com/soyaos/developer-portal/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/soyaos/developer-portal/releases/tag/v0.2.0
[0.1.0-alpha.0]: https://github.com/soyaos/developer-portal/releases/tag/v0.1.0-alpha.0
