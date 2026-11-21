# Ideas come from locked-down agents in claude-agent-service

The scout run and the link reader are Claude agents. They run in claude-agent-service on the existing subscription, behind two routes: `POST /v1/datenight/scout` and `POST /v1/datenight/link`. The app does not call a model API itself. We chose this because it adds no spend. The Anthropic API would be a new monthly cost, and the free OpenRouter models did weaker web research.

The agents read untrusted public pages, so each route starts its agent with only WebSearch and WebFetch. It also gets a scrubbed environment and a fixed prompt, and only validated values change between runs. A route runs one agent at a time and caches its answer, so an app that retries does not start a second search. The app holds a token for these two routes only (`DATENIGHT_SCOUT_TOKEN`), never the `/execute` token, and it validates every field again before it stores an Idea.

## Consequences

- A scout run takes several minutes and can cost up to $3 of the subscription's budget, a link read up to $1. The app starts one in the background and reads the outcome from `job_runs`.
- A change to what the scout looks for is a change to `agents/date-scout.md` or `app/datenight_scout.py` in claude-agent-service, not to this repo.
