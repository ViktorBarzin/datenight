# Instagram and TikTok posts are read anonymously with yt-dlp

Most links the Owner sends in are Instagram or TikTok posts. The link route in claude-agent-service reads each post's caption and thumbnails with `yt-dlp -J --no-download`, signed in to nothing, and then asks the agent to find the venue. We rejected signing in with the Owner's accounts: a run of automated sign-ins once got an account refused from the home IP. We also rejected Meta's Graph API, which reads only posts from accounts you manage.

## Consequences

- When a site stops serving anonymous reads, the agent has only the note: what the Owner wrote, plus any caption Muse could see. The brief tells Muse to send both.
- The thumbnails expire, so the app keeps copies of them (ADR 0009).
- When the agent finds no match, the link is `not_found` and the Owner can try it again. The agent takes the closest real venue over nothing.
