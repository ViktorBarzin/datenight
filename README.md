# Date Night

A private app that finds one new London date a week. It keeps the Ideas,
the Past dates and the couple's taste; Meta's Muse runs the weekly routine
on WhatsApp and books the Idea the Owner picks
([ADR 0001](docs/adr/0001-muse-drives-the-week.md)). The words are in
[GLOSSARY.md](GLOSSARY.md) and the plan is
[docs/plans/2026-11-21-datenight-plan.md](docs/plans/2026-11-21-datenight-plan.md).

| Part | Where |
|---|---|
| The rules: repeats, ranking, the Date evening, history, iCalendar | `src/domain/` (pure, unit-tested) |
| Ideas, the Shortlist, Dates, jobs | `src/server/{ideas,week,dates,jobs}.server.ts` |
| Calendar, TripIt, Actual Budget, Immich, the scout, postcodes | `src/server/integrations/` |
| Links the Owner sends in, and photos for each Idea | `src/server/{links,photos}.server.ts`, `src/domain/photos.ts` |
| The API Muse calls, and its brief | `src/server/muse.server.ts`, `/muse/brief` |
| Settings, all optional | `dateNightSettings()` in `src/server/env.server.ts` |

Every Sunday the pod refreshes history at 19:00 and runs the scout at 20:00
London time (`SCHEDULER=on`). The scout is the `date-scout` agent in
claude-agent-service (`POST /v1/datenight/scout`). The first `GET
/api/muse/week` of a week makes its Shortlist.

A link pasted on the Ideas page, or forwarded to Muse (`POST /api/muse/links`),
goes to the `date-link` agent (`POST /v1/datenight/link`), which reads an
Instagram or TikTok post with yt-dlp and finds the venue. Every scheduler tick
finds up to 8 photos for a few Ideas from their pages; Instagram and TikTok
images expire, so the app keeps copies of those in `stored_photos`.

Built on the default app stack (app-kit ADR-0001): TanStack Start on Bun,
Drizzle on the shared Postgres, Authentik sign-in through app-side OIDC,
realtime over LISTEN/NOTIFY and SSE.

## On Cloud

On Cloud there are no infra steps: Cloud builds and deploys every push to
`master`, signs people in and runs the database. [AGENTS.md](AGENTS.md) has
the agent and code conventions; its "On Cloud" section covers working on
this app there, and "Test locally first" lists the checks to run before a
push.

## Requirements

Bun 1.4.3 or newer (`packageManager` in `package.json`). On the devvm,
`~/.bun/bin/bun` is 1.3.11 and comes first on PATH, so run
`/usr/local/bin/bun` or put `/usr/local/bin` first; `bun run` scripts call
whichever `bun` is first on PATH, and the server and `rename` refuse to start
on an older one.

## Run locally

With a Postgres you can reach (a throwaway `docker run -e
POSTGRES_PASSWORD=dev -p 127.0.0.1:5433:5432 postgres:18` works):

```sh
bun install
export DATABASE_URL=postgres://postgres:dev@127.0.0.1:5433/postgres
bun run build && bun run migrate          # applies drizzle/ to that database
DEV_USER=me PORT=3100 bun run dev         # http://127.0.0.1:3100, signed in as "me"
```

`DEV_USER` stands in for sign-in only while `NODE_ENV` is `development` or
`test` and no OIDC client is configured; `bun run dev` sets
`NODE_ENV=development`. Tests: `TEST_DATABASE_URL=<admin url> bun run test`
(each test makes and drops its own database), then `bun run test:e2e`. The
end-to-end tests need Playwright's browser, which a fresh home directory
lacks; install it once with `bunx playwright install chromium-headless-shell`.
If that install fails with `ENOSPC`, the temp directory is full: set `TMPDIR`
to a directory under `$HOME` and run it again (AGENTS.md, "Test locally
first").

## Off Cloud

To run the app on the homelab cluster without Cloud, follow
[docs/new-app.md](docs/new-app.md): the rename, the infra steps, the GitHub
mirror and CI, in order.

This template is generated. Its source of truth is `template/` in
[viktor/app-kit](https://forgejo.viktorbarzin.me/viktor/app-kit), where it
builds and its HTTP and Playwright tests run against the `@viktorbarzin/*`
packages in the same commit. `scripts/export-template.ts` there refreshes
`viktor/app-template` after the packages are published, replacing each
`workspace:^` range with `^<published version>` and writing `bun.lock`.
Change the template in app-kit, not in `viktor/app-template`. Until those
packages are on Forgejo's npm registry and the export has written
`bun.lock`, the template's own build fails at its first step with "publish
@viktorbarzin packages first". `bunfig.toml` points the `@viktorbarzin` scope
at that registry.
