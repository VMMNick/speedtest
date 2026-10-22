<div align="center">

# Speedcheck

**An accurate in-browser internet speed test in plain JavaScript**

Ping · jitter · loss · download · upload · bufferbloat · connection stability

[Українська](README.md) · **English**

[![CI](https://github.com/VMMNick/speedtest/actions/workflows/ci.yml/badge.svg)](https://github.com/VMMNick/speedtest/actions/workflows/ci.yml)
[![DB backup](https://github.com/VMMNick/speedtest/actions/workflows/backup.yml/badge.svg)](https://github.com/VMMNick/speedtest/actions/workflows/backup.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white)
![Initial JS](https://img.shields.io/badge/initial%20JS-~19%20KB%20gzip-0a7cff)
![Lighthouse](https://img.shields.io/badge/Lighthouse-98%20%C2%B7%20100%20%C2%B7%20100-0cce6b?logo=lighthouse&logoColor=white)

[**Open the demo**](https://vmmnick.github.io/speedtest/) · [Version with analytics](https://speedtest-v003.onrender.com/analytics.html) (the free server takes up to a minute to wake up) · [How it works](docs/measurement.md) · [Architecture](docs/architecture.md)

<img src="docs/media/demo.gif" alt="A full test: ping, download and upload with a live chart and the final grade" width="900">

</div>

> The interface switches between Ukrainian and English on the fly; the screenshots show the Ukrainian version. Detailed docs in `docs/` are in Ukrainian.

## Why it is interesting

- **Measurement, not a progress bar.** Speed is the 90th percentile over a sliding window after TCP ramp-up (as Cloudflare and Ookla do it); ping comes from the Resource Timing API with server time subtracted (`Server-Timing`); a phase ends early once speed is stable (CV ≤ 5%). [Details →](docs/measurement.md)
- **Bufferbloat.** Ping is also measured _under load_ — what you feel in games and video calls, and what ordinary speed tests do not show.
- **No UI freezes, even on gigabit.** The whole engine runs in a Web Worker; Chart.js (~¾ of all JS) loads only when needed — initial JS is ~19 KB gzip, and the English dictionary loads only when needed.
- **Full stack.** An optional Fastify + PostgreSQL + Redis backend: anonymous statistics, a provider ranking and a "when is the internet fastest" heatmap with k-anonymity and cached aggregations.
- **Background jobs on BullMQ.** Every 10 minutes a worker compares each provider's speed "now" with its usual two weeks, flags degradation and keeps an incident log; once a day it prunes old results.
- **Production hygiene.** Strict CSP without `unsafe-inline`, a PWA with a hand-written service worker, two languages switched live, WCAG 2.1 AA (axe), ~200 tests, CI with 8 jobs: Lighthouse thresholds and visual regression tests on every PR, a daily database backup.

## Screenshots

| Light theme                                              | Dark theme                                             |
| -------------------------------------------------------- | ------------------------------------------------------ |
| ![Test result, light theme](docs/media/result-light.png) | ![Test result, dark theme](docs/media/result-dark.png) |

| Analytics (demo data)                                     | History                                              | Mobile                                                             |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| ![Provider ranking and heatmap](docs/media/analytics.png) | ![Test history with a chart](docs/media/history.png) | <img src="docs/media/mobile.png" alt="Mobile version" width="220"> |

> The providers in the screenshots are made up and the "network" is a local server with a throttled link: `npm run media` reproduces the shots.

## Features

| What               | Details                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Measurement**    | ping, jitter (RFC 3550), loss, download/upload over parallel streams with adaptive chunks, bufferbloat (A–F), stability 0–100 |
| **Interpretation** | fit for gaming, video calls and 4K; % of your provider plan; comparison with the previous test ↑/↓                            |
| **History**        | IndexedDB (localStorage fallback), chart, period filter, CSV export                                                           |
| **Sharing**        | a link with the result encoded in the URL itself (no server, no IP), a 1200×630 PNG card, the native share sheet on mobile    |
| **Analytics**      | provider ranking (median and P90), city filter, day × hour heatmap in the viewer's time zone, demo mode while data is scarce  |
| **Experience**     | PWA and offline, light/dark theme without a flash, uk/en, keyboard (`Enter`/`Esc`), `prefers-reduced-motion`, privacy page    |

## How it fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/architecture-dark.svg">
  <img src="docs/media/architecture-light.svg" alt="Architecture: the browser (UI and a Web Worker) measures against Cloudflare, the anonymous result goes to Fastify, data lives in PostgreSQL and Redis, GitHub Actions backs it up nightly" width="760">
</picture>

- **`apps/web/src/core`** — pure measurement logic without the DOM (runs in the worker, tested in Node); **`apps/web/src/services`** — network, storage, PWA; **`apps/web/src/ui`** — everything that touches the DOM; **`packages/shared`** — the result's JSON Schema, shared by the browser and the server (`apps/server`). An npm workspaces monorepo: one `npm install` sets up everything.
- ESLint enforces the layer boundaries, and a contract test runs the browser's request body through the server's real validation. [Architecture →](docs/architecture.md)
- The API is documented as OpenAPI 3.1 generated from the validation schemas: [Swagger UI](https://speedtest-v003.onrender.com/api/docs) · [`docs/openapi.json`](docs/openapi.json).
- Three build modes from one codebase: **GitHub Pages** (Cloudflare only), **cloud** (Render: Cloudflare + statistics), **selfhosted** (its own measurement endpoints — to check Wi-Fi on a local network).

## Tech stack

| Layer          | Stack                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Frontend       | Vanilla JS (ES modules, JSDoc + `checkJs`), Web Workers, Chart.js, Vite, custom CSP and service worker plugins |
| Backend        | Node.js 22, Fastify 5, PostgreSQL 18 (Neon), Redis, BullMQ, JSON Schema, OpenAPI 3.1 / Swagger UI              |
| Quality        | Vitest, Playwright (E2E + axe), ESLint, Prettier, TypeScript checking of JS                                    |
| Infrastructure | Docker (multi-stage, non-root), GitHub Actions, GitHub Pages, Render, Dependabot                               |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # lint + format + typecheck + unit tests
npm run test:e2e     # Playwright (run npx playwright install chromium first)
```

Full stack with the database and Redis:

```bash
docker compose up -d --build   # http://localhost:8080, analytics at /analytics.html
```

Requires Node.js 22.12+. Deploy to Render with one button (the `render.yaml` Blueprint):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/VMMNick/speedtest)

## Documentation (in Ukrainian)

| Document                                     | What it covers                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| [How measurement works](docs/measurement.md) | Cloudflare endpoints, P90, Server-Timing, early stop, bufferbloat, limitations |
| [Architecture](docs/architecture.md)         | folder structure, dependency rules between layers, worker protocol             |
| [Server and deploy](docs/server.md)          | API, privacy, analytics, Docker, Render, Neon, backups                         |
| [Development](docs/development.md)           | commands, size budget, tests, CI, i18n, PWA, CSP, screenshots                  |

## Author

Mykola Vorobkanych ([@VMMNick](https://github.com/VMMNick)) — full-stack developer.
