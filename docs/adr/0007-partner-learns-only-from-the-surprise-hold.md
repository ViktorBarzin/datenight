# The Partner learns of a date only from the Surprise hold

The Partner is not a user of the app, so a surprise cannot leak through a shared view. When Muse posts a booking, the app writes two events to the Owner's Nextcloud calendar. The first is the Owner's own event with the venue. The second is a "Surprise date" hold that invites the Partner and holds only the time, the area and the dress code. The app ignores the Partner's reply to the hold.

We rejected sending the hold from the Owner's Gmail through Muse, because it depends on a Muse connector. We also rejected a surprise mode for two users: hidden items leak through lists, counts and notifications.

## Consequences

- The Partner's name and email live in Vault `secret/datenight` and reach the code as settings. The public repo, its tests and the Muse brief never hold them.
- The hold must never contain the venue, the booking reference or a link.
