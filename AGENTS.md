# datenight

> [!WARNING]
> TanStack Start is NOT Next.js. There is no `getServerSideProps`, no
> `"use server"` / `"use client"` directive, no App Router (`app/page.tsx`,
> `layout.tsx`, `route.ts`), no `next/*` import and no React Server Actions.
> Data loads in route `loader`s and server functions (`createServerFn`);
> HTTP endpoints are server routes (`createFileRoute(...)({ server: { handlers } })`).
> If you catch yourself writing a Next.js pattern, load the skills below first.

`datenight` is Date Night: a private app that finds the Owner one new London
date a week. It keeps the Ideas, the Past dates and the taste; Meta's Muse runs
the weekly routine on WhatsApp and books the Idea the Owner picks. It is built
on the default app stack (app-kit ADR-0001): TanStack Start on Bun, Drizzle on
the shared CNPG Postgres, Authentik sign-in through app-side OIDC, realtime
over Postgres LISTEN/NOTIFY and SSE. Every push to `master` builds and
deploys, so land only verified work there.

## Read first

- `GLOSSARY.md` holds the domain words (Idea, Repeat, Shortlist, Deck,
  Surprise hold...). Use them, with their meaning there, in code, tests,
  commits and docs.
- `docs/adr/` holds the decisions. Read the ADR for an area before you change
  it, and add one when a change is hard to reverse, surprising and a real
  trade-off:

  | ADR | Area |
  |---|---|
  | 0001 | Muse drives the week; the app never messages or books |
  | 0002 | runs in the cluster on the infra path, not on Cloud |
  | 0003 | the scout and link agents in claude-agent-service |
  | 0004 | Instagram and TikTok read anonymously with yt-dlp |
  | 0005 | what counts as a Repeat |
  | 0006 | Past dates proposed from evidence, confirmed by the Owner |
  | 0007 | the Partner learns of a date only from the Surprise hold |
  | 0008 | background jobs in the web pod, claimed in `job_runs` |
  | 0009 | photos hotlinked; Instagram and TikTok images copied |
  | 0010 | Muse's bearer token and the public brief |
  | 0011 | swipes: a Pass is final, one refill a day |

- `README.md` maps each part of the app to its files.

## Rules of this repo

- **Public repo, private people.** Only the Owner is named. The Partner's
  name, email and the home position live in Vault `secret/datenight` and
  reach the code as settings (`dateNightSettings()`). Tests, fixtures,
  commits, the Muse brief and every page outside sign-in use made-up or
  role names.
- **Rules are pure, and tested first.** `src/domain/` holds the rules
  (repeats, ranking, the Date evening, history, photos, iCalendar) with no
  database and no I/O. Write the failing `bun test` there before the change.
- **Outside calls go through `Deps`** (`src/server/deps.server.ts`): the
  calendar, TripIt, the Noticing File, geocoding, page fetches and the link
  reader. Server tests pass a fake `Deps`
  (`fake()` in `flow.server.test.ts`), so no test reaches a live site.
- **Every setting is optional.** A missing one throws `NotConfigured`, and
  the page or job reports what is not set up. A new setting is an infra
  change too (ADR 0002).
- **Budget live agent runs.** A scout run costs minutes and up to $3, a link
  read up to $1 (ADR 0003). Start one at a time, from the app's own buttons
  or a real link, and read the outcome before the next.
- **Muse's API is a contract.** Change `/api/muse/*` additively. When the
  routine changes, update `src/server/brief.server.ts`, then tell Muse to
  read `/muse/brief` again with `homelab delegate muse "<message>"`. The
  Muse token stays in Vault and out of every chat.
- **The Surprise hold** holds the time, the area and the dress code, never
  the venue, the booking reference or a link (ADR 0007).

## Live app

| Task | How |
|---|---|
| Land a change | `homelab work start <topic>`, then `homelab work land --verify-cmd "<the line in Commands>"` |
| Wait for the deploy | GitHub Actions builds, then Woodpecker (repo 546) deploys: `homelab deploy wait datenight/datenight` |
| Settings and secrets | infra `stacks/datenight/main.tf`, Vault `secret/datenight` |
| The scout and link agents | claude-agent-service: `app/datenight_scout.py`, `app/datenight_link.py`, `agents/date-*.md` |
| A broken pod | `homelab k8s debug datenight` |
| Job outcomes | "Behind the scenes" on the home page, or the `job_runs` table; Loki alert `DateNightJobFailed` |
| See a page as the Owner | `homelab browser as <owner> --format playwright`, then `homelab browser as --end <owner>`; always name the user |
| Read live data | `kubectl -n dbaas exec <primary pod> -c postgres -- psql -d datenight -tAc "<select>"`; claim with `presence` before a write |

- **jsonb reads in SQL.** The jsonb columns (`photos`, `evidence`...) hold
  a JSON string, encoded twice by the driver. The app's own reads are right;
  in hand-written SQL, read them with `col #>> '{}'`.
- **Real side effects.** A booking posted to `/api/muse/bookings` writes to
  the Owner's calendar and invites the Partner. Test the booking flow
  against fakes, never against the live app.

## Load the TanStack skills before you write Start or Router code

TanStack ships agent skills inside its npm packages (TanStack Intent), written
for the installed version. `package.json` → `intent.skills` lists the
packages whose skills we use.

```sh
bun run intent list                                   # what is available
bun run intent load @tanstack/start-client-core#start-core/server-routes
```

Use `bun run intent`, not `bunx intent`: another TanStack package ships an
`intent` binary that shadows Intent's in `node_modules/.bin`.

| Task | Load |
|---|---|
| Any Start work (start here) | `@tanstack/start-client-core#start-core`, `@tanstack/react-start#react-start` |
| What runs where (server vs client vs both) | `@tanstack/start-client-core#start-core/execution-model` |
| /api endpoints | `@tanstack/start-client-core#start-core/server-routes` |
| Server functions (UI RPC) | `@tanstack/start-client-core#start-core/server-functions` |
| Middleware, request context | `@tanstack/start-client-core#start-core/middleware` |
| Sessions, auth guards | `@tanstack/start-client-core#start-core/auth-server-primitives`, `@tanstack/router-core#router-core/auth-and-guards` |
| Routes, loaders, search params, navigation | `@tanstack/router-core#router-core` and its sub-skills |
| Build and deploy | `@tanstack/start-client-core#start-core/deployment` |
| Habits from Next.js | `@tanstack/react-start#lifecycle/migrate-from-nextjs` |

## Server-only code lives in `*.server.ts`

Everything that touches the database, secrets or Bun's built-ins lives under
`src/server/` in files named `*.server.ts`. Import those modules only from
server route handlers, server function handlers, other `*.server.ts` modules,
`src/start.ts` middleware `.server(...)` bodies and `src/entrypoints/*`.

Never import them from a component, a hook or a plain helper module that a
component imports. Start strips server-function and server-route bodies from
the client bundle, but a plain exported helper that touches the database,
sitting in a module the client imports, pulls the Postgres driver into the
browser bundle. `vite build`, `tsc` and `curl` all pass; only a real browser
shows `Buffer is not defined` on hydration, after which no button works.
After adding server code, run `bun run test:e2e` (a real Chromium) before
calling it done.

## Server functions vs server routes

- Server functions (`createServerFn`, `src/server/*.functions.ts`) are
  internal RPC for this app's own UI. They are served at `/_serverFn/<hash>`
  and speak seroval, so CLIs, agents and Home Assistant cannot call them.
- Anything a non-browser client calls is a server route under `/api` with a
  zod schema (`readJson`/`readQuery` from `@viktorbarzin/runtime`) and
  `appAuth.handleApi` for identity. `/api/muse/*` checks Muse's own token
  instead (ADR 0010).
- The validator method in Start 1.169 is `.validator()`, not
  `.inputValidator()` (older docs and model memory use the latter).
- `src/routeTree.gen.ts` is generated by `vite build` / `vite dev` and is
  committed. `tsr generate` writes a different file; do not use it.
- Query keys come from `src/lib/query-keys.ts`. Biome has no TanStack Query
  lint, so a hand-typed key that does not match never invalidates.

## Which package owns what

| Package | Owns | Wired in |
|---|---|---|
| `@viktorbarzin/log` | JSON-lines logs with OpenTelemetry field names (app-kit ADR-0002), the per-request log context, console redirection | everywhere, `nitro-plugin.server.ts`, `start.ts`, `auth.server.ts` |
| `@viktorbarzin/runtime` | process singletons, idle timeout, drain and shutdown, error envelope, zod body/query validation, anti-framing headers, `/healthz` | `start.ts`, `nitro-plugin.server.ts`, `/api` routes |
| `@viktorbarzin/metrics` | the process registry, `http_requests_total` and `http_request_duration_seconds`, `/metrics` on METRICS_PORT | `start.ts`, `nitro-plugin.server.ts` |
| `@viktorbarzin/pg` | the pool (password file re-read per connection), the connection budget, migrations under an advisory lock, the migrate CLI, test databases | `db.server.ts`, `env.server.ts`, `entrypoints/migrate.ts` |
| `@viktorbarzin/oidc-token` | bearer JWT verification (RS256, issuer, audience, exp) | through `@viktorbarzin/auth` |
| `@viktorbarzin/auth` | Better Auth sign-in, sessions, membership re-checks, request + approve, CSRF; cloud mode (`createCloudAuth`) | `auth.server.ts`, `routes/api/auth/*`, `start.ts` |
| `@viktorbarzin/realtime` | LISTEN/NOTIFY, the SSE hub, the browser client, the query-invalidation hook | `realtime.server.ts`, `routes/api/events.ts`, `routes/index.tsx` |
| `@viktorbarzin/telemetry` | the Rybbit script (pageviews, replay), product events, Sentry init | `components/telemetry.tsx`, `routes/__root.tsx`, `nitro-plugin.server.ts` |

Only `src/server/env.server.ts` reads `process.env`. It maps the Terraform
app module's env contract onto the package configs. The template's Cloud
paths (`CLOUD_*`, `createCloudAuth`, `bucket.server.ts`, `e2e/cloud.spec.ts`)
stay for its tests and never run here (ADR 0002).

The packages keep TanStack Start out of their dependencies: they take a
`Request` and return a `Response` or data, and this app wires them into
middleware and routes. Start ships breaking changes in minor releases, so it
is pinned to an exact version here and upgraded by hand.

## Telemetry and logs

Telemetry is on by default (app-kit ADR-0002, infra ADR-0041). It starts
whenever `TELEMETRY_WRITE_KEY` (or `TELEMETRY_WRITE_KEY_FILE`) is set, and
stays off in local runs and tests, which have no key.

| Env | Meaning | Default |
|---|---|---|
| `TELEMETRY_WRITE_KEY` | the app's write key, Vault `secret/rybbit` `write_keys` | unset: telemetry off |
| `SENTRY_DSN` | the GlitchTip DSN, `https://<key>@<app host>/_t/x/<project>` | unset: no error reports |
| `TELEMETRY_SITE_ID` | the Rybbit site | `app.telemetry.siteId` (1) |
| `TELEMETRY_EVENTS_URL` | the event pipeline, for server-side events | `http://event-pipeline.rybbit.svc.cluster.local` |
| `SERVICE_VERSION` | the release: on Cloud, the running Deploy's commit; elsewhere, set in the image by this repo's CI build | `dev` |
| `DEPLOYMENT_ENVIRONMENT` | `deployment.environment.name` | `production` when `NODE_ENV=production`, else `dev` |
| `TELEMETRY` | `off` to opt out at run time | on |

To opt out for good, set `telemetry.enabled: false` in `src/app.config.ts`.

- The browser loads the Rybbit script and the Segment client only on the
  production hosts in `app.telemetry.productionHosts`, so local dev sends
  nothing. Pageviews and replay need no code.
- Product events are `noun.past_verb` with snake_case property keys:
  `track("idea.liked", { idea_id })` from `@viktorbarzin/telemetry/browser`
  in components, or `track({ event, properties, userId })` from
  `@viktorbarzin/telemetry/server` in server code. The app sends none yet.
  Both drop events the pipeline would reject; the server logs why.
- Sign-in reloads the page, and `components/telemetry.tsx` then identifies
  the person by their `sub`. Call `reset()` from the browser entry on
  sign-out.
- Use `requireMember` from `auth.server.ts` in server functions: it puts the
  person's `sub` on the request's log lines as `enduser.id`. Extras you pass
  to a logger are snake_case.
- Access lines (`request`, with the path and status) cover only `/api/*`
  routes (`observeRequest` in `src/start.ts`). Server functions and page
  loads log only errors and what the code logs, so the pod's logs show no
  line for them. To see a failing server function there, log it yourself
  inside the handler after `requireMember`, whose request context tags the
  line with the person.

## Database

- Connection budget: 5 per pod on a shared primary. The pool takes 4
  (`APP_POOL_MAX`), the realtime LISTEN connection 1; the migrate init
  container uses 1 more while it runs. More replicas or a CronJob multiply
  this, so ask Viktor before adding either; background work runs in
  the web pod instead (ADR 0008).
- Migrations are additive: expand in one release, contract in a later one, so
  the previous image stays a working rollback. `bun run db:generate` writes
  them to `drizzle/`; the init container applies them under
  `pg_advisory_lock`.
- The same rule covers server functions. A tab opened before a deploy keeps
  running the old client: it calls the old server function by its name and
  input, and reads the return shape it was built for, until it reloads. A
  renamed or removed function logs `Server function info not found` on the
  server, and a changed return shape breaks the old page (for example
  `data.map is not a function`). Add the new function or field first, and
  remove the old one in a later release.
- The identity tables come from `@viktorbarzin/auth/schema`. A change there is
  a major version of that package and needs a regenerated migration here.

## Realtime

A write that other tabs should see publishes inside its own transaction:

```ts
await db.transaction(async (tx) => {
	await tx.update(ideas).set(...);
	await realtime.publishInTx(tx, null, { type: "invalidate", keys: [ideaKeys.all], source });
});
```

The NOTIFY fires at COMMIT, so a rolled-back write tells no one. Each tab's
stream (`/api/events`) subscribes to its user's topic, `user.sub`. The
second argument picks who hears the event: `ownerSub` reaches every tab of
that user, and `null` reaches every open stream. Use `null` for shared data
that every member sees; a write published to the writer's topic never
reaches the other members' tabs. The client hook (`useRealtimeInvalidation`)
invalidates those keys in every tab but the one that wrote, and refetches
every active query after a reconnect or `resync`. Payloads name keys, never
data, and stay under 7,900 bytes. Date Night has one member, so it publishes
to `null` (`ideasChanged` in `app.functions.ts`).

## Commands

This app needs Bun 1.4.3 or newer (`packageManager` in package.json). On the
devvm, `~/.bun/bin/bun` is 1.3.11 and comes first on PATH; run
`/usr/local/bin/bun`, or put `/usr/local/bin` first. `bun run` scripts call
whichever `bun` is first on PATH, and the server refuses to start on an older
one.

After `dev`, in the order CI runs them:

```sh
bun run dev            # vite dev under Bun on 127.0.0.1:${PORT:-3000}
bun run check          # biome
bun run build          # vite build + the migrate entrypoint; writes src/routeTree.gen.ts
bun run typecheck      # after the build: tsc needs the route tree a new route adds
bun run test           # bun test; DB and HTTP tests need TEST_DATABASE_URL and a build
bun run test:e2e       # Playwright against the built server
```

To run it locally against a database (README, "Run locally"):
`DATABASE_URL=... bun run build && bun run migrate`, then
`DATABASE_URL=... DEV_USER=<name> PORT=<free port> bun run dev`. `DEV_USER`
stands in for sign-in only when `NODE_ENV` is `development` or `test` and no
OIDC client is configured.

The full check before `homelab work land`, against a throwaway Postgres
(`docker run -d --rm -e POSTGRES_PASSWORD=dev -p 127.0.0.1:5433:5432
postgres:18`), is its `--verify-cmd`:

```sh
bun run check && bun run build && bun run typecheck && TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5433/postgres bun run test && TEST_DATABASE_URL=postgres://postgres:dev@127.0.0.1:5433/postgres bun run test:e2e
```

Build before typecheck: `vite build` writes `src/routeTree.gen.ts`. Without
`TEST_DATABASE_URL` the database tests are skipped, and a run with skipped
tests is not done. The browser tests need `bunx playwright install
chromium-headless-shell` once; on `ENOSPC`, set `TMPDIR` to a directory
under `$HOME`. Remove the Postgres container after.
