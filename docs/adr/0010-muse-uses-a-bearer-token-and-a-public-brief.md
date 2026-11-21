# Muse calls the app with a static bearer token and reads a public brief

Muse is a machine client. It cannot run the Authentik sign-in, so `/api/muse/*` takes one static bearer token, `MUSE_TOKEN`, which the app compares in constant time. Muse fetches the token from Vault through its homelab access, so the token never appears in a chat. The routine Muse follows is the brief at `/muse/brief`. The brief is public so that Muse can read it with no token, and so it holds no names and no secrets.

## Consequences

- The API is a contract with Muse's scheduled tasks. Change it additively, and when the routine changes, update `src/server/brief.server.ts` and tell Muse to read the brief again.
- Muse's own browser fails Cloudflare's bot check on this host, so Muse calls the API through its infra agent.
