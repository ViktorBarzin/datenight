# The app runs in the homelab cluster, not on Cloud

Most new apps here start on Cloud with `cloud new`. Date Night reads services that only the cluster reaches: Actual Budget, Immich, the Nextcloud calendar and claude-agent-service. A Cloud app has no route to them, so the app runs on the infra path: the `tanstack_app` module in `stacks/datenight`, a database on the shared CNPG cluster, its settings in Vault `secret/datenight`, a GitHub Actions build and a Woodpecker deploy.

## Consequences

- A new setting is an infra change: add it to `stacks/datenight/main.tf` (`env`, or `vault_env` for a secret) and read it in `dateNightSettings()` in `src/server/env.server.ts`.
- The pod has a budget of 5 database connections. A second replica or a CronJob spends more of it, which is one reason background work runs inside the web pod (ADR 0008).
- The template's Cloud code paths stay in the repo but never run.
