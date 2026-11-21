# Muse drives the week; the app only knows

The app keeps the Ideas, the Past dates and the taste, and it never messages the Owner or books anything. Meta's Muse runs the weekly routine from its own scheduler: it pulls the Shortlist from the app's `/api`, checks availability and books in its own browser with the Owner's sign-ins, talks to the Owner on WhatsApp, and posts each booking and Rating back. We chose this because Muse already has a scheduler, a real browser and the Owner's WhatsApp chat, while booking sites block headless browsers in the cluster and the homelab's own path to message Muse (`homelab delegate`) had never carried a message.

## Consequences

- The app works with no Muse at all through its web pages; only the WhatsApp loop and the bookings stop.
- The Muse routine lives in Muse, built from the brief the app serves at `/muse/brief`. A change to the routine is a change to that brief, followed by one message to Muse.
- The app sends the Surprise hold itself, from the Owner's Nextcloud calendar, once Muse posts a booking. It ignores the Partner's reply to the hold.
