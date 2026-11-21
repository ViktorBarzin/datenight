# Background work runs in the web pod, claimed in job_runs

The Sunday history refresh, the Sunday scout run, the midweek refill, link reading and photo finding all run in the one web pod. A timer ticks every 5 minutes when `SCHEDULER=on`. Each periodic job first claims a row in `job_runs` keyed by its period. A restart, or the second pod during a rolling deploy, then never runs the same period twice. We rejected Kubernetes CronJobs, because each one spends more of the 5-connection database budget and still needs a loop for links and photos.

## Consequences

- When the pod misses Sunday evening, a tick on Monday before 09:00 catches up.
- A failed run records `failed` with the error in `job_runs`, and the Loki alert `DateNightJobFailed` fires. The home page lists recent runs.
- A job is safe to run twice only through its claim. A new job claims a period key first: the London date for a daily job, as the refill does with `refill-YYYY-MM-DD`.
