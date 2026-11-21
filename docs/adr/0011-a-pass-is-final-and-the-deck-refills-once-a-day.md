# A Pass is final, and the Deck refills at most once a day

On the Swipe page, a Pass dismisses the Idea for good and a Like puts it first in the next Shortlist. Each swipe moves the taste weight of the Idea's category by a third of one rating step, so a real Rating counts for more than a swipe. When fewer than 10 Ideas are left to swipe, a swipe starts one refill scout run, at most one each London day. We capped it because each scout run takes minutes and up to $3 of the subscription's budget (ADR 0003). Each run also gets the venues the app already knows, so it looks for new ones.

## Consequences

- Undo takes back the last swipe, and "Not for us" on the Ideas page is the same as a Pass.
- A Deck swiped empty stays empty until a scout run adds Ideas: the refill, or the Sunday run.
