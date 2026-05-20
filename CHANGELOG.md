# Changelog

All notable changes to the Developer Portal will be documented in this file.

The format is based on [Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/),
and this site adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
