---
status: draft
plan: true
---

# Date Night: a private app that finds one new London date a week

Weekly dates now start from a blank page, and nothing remembers what we already did. At the end, a WhatsApp message brings three new ideas every Monday for the next week, and Muse books the one I pick.

## In numbers

```numbers
caption: targets for the first live week; costs from the zero-new-spend rule
rows:
  - {label: new ideas offered each week, before: "0", after: "3"}
  - {label: ideas checked against past dates, before: "none", after: "every idea"}
  - {label: my steps from idea to booking, before: "search, compare, book", after: "1 reply in WhatsApp"}
  - {label: new monthly spend on software, before: "£0", after: "£0"}
  - {label: public web pages the scout reads each week, before: "0", after: "about 40", better: false}
```

## The system, with the change on it

```topology
caption: the app keeps the memory and the taste; Muse talks to me and does the booking
direction: TD
groups:
  - {id: me, label: Me}
  - {id: muse, label: Meta Muse}
  - {id: cluster, label: Homelab cluster}
  - {id: web, label: London web}
nodes:
  - {id: phone, label: WhatsApp on my phone, group: me, state: same}
  - {id: muse, label: Muse weekly routine, note: own cron and browser, group: muse, state: new, risk: medium}
  - {id: app, label: Date Night app, note: ideas, past dates, taste, private, group: cluster, state: new, risk: low}
  - {id: db, label: datenight database, group: cluster, state: new, risk: low}
  - {id: scout, label: date-scout agent, note: new agent in claude-agent-service, group: cluster, state: new, risk: medium}
  - {id: history, label: Calendar, TripIt, Actual Budget, Immich, note: read; calendar also gets the hold, group: cluster, state: same}
  - {id: noticing, label: Noticing File, note: read only, group: cluster, state: same}
  - {id: listings, label: Listing sites, note: Time Out, Secret London, DesignMyNight, Fever, Obby, group: web, state: same}
  - {id: booking, label: Booking sites, note: OpenTable, TheFork, Fever, group: web, state: same}
edges:
  - {from: app, to: scout, state: new, label: Sunday scout run}
  - {from: scout, to: listings, state: new, label: reads public pages}
  - {from: app, to: history, state: new, label: past dates, free evenings, trips, surprise hold}
  - {from: app, to: noticing, state: new, label: her wishes as hints}
  - {from: app, to: db, state: new}
  - {from: muse, to: app, state: new, label: shortlist, booking, rating}
  - {from: muse, to: booking, state: new, label: availability and booking}
  - {from: muse, to: phone, state: new, label: 3 ideas, then the booking}
checks:
  - {node: app, text: "bun test proves the repeat rule and the score on fixed data", status: open}
  - {node: scout, text: "one real scout run stores at least 10 new ideas with links", status: open}
  - {node: history, text: "the import finds past dates I recognise and I confirm them in the app", status: open}
  - {node: muse, text: "one real Monday: Muse sends 3 ideas, books my pick, posts the booking back", status: open}
left_out:
  - My partner as a user of the app, so that surprises stay hidden
  - homelab push to Muse through homelab delegate, because nothing has used that path and its contacts file does not exist
  - booking from the cluster, because booking sites block headless browsers and need my sign-ins
  - My partner's calendar, because her Google import 404s in Nextcloud
```

## Decisions

```decision
- question: Who uses the app?
  options:
    - {name: Only me, chosen: true}
    - {name: Both of us with a surprise mode, note: hidden items leak through shared views}
    - {name: Both of us fully shared, note: no surprises}
  why: Surprises stay surprises, and the app can read the unshared Noticing File.
- question: What does a weekly date cost?
  options:
    - {name: "£20-80, one splurge a month", chosen: true}
    - {name: "£20-50 always", note: excludes most shows}
    - {name: "£50-150", note: too much every week}
  why: Most weeks stay cheap, and one big date a month is still possible.
- question: When do dates happen?
  options:
    - {name: "Tuesday or Wednesday from 19:00, else Monday or Friday, never Thursday", chosen: true}
    - {name: Friday or Saturday evening}
    - {name: Weekend daytime}
  why: My choice. Thursday is my salsa class. The app reads my calendar for the free evening.
- question: How far ahead does the Shortlist look?
  options:
    - {name: The next week, 8 to 10 days out, chosen: true}
    - {name: The same week, note: more sold-out shows}
    - {name: Two weeks out, note: less spontaneous}
  why: Popular shows and classes sell out early.
- question: What happens in a week when I travel?
  options:
    - {name: The app skips the week and Muse tells me, chosen: true}
    - {name: Send the Shortlist anyway}
  why: A trip in TripIt or the calendar already answers the question.
- question: How does my partner learn about a date?
  options:
    - {name: "A surprise hold from my Nextcloud calendar: time, rough area, dress code", chosen: true}
    - {name: "The same hold from my Gmail through Muse", note: depends on a Muse connector}
    - {name: Full details, note: no surprise}
  why: Same shape as the anniversary hold. Nextcloud mail already works. The app ignores her reply.
- question: What does the app favour before it has ratings?
  options:
    - {name: "Immersive and shows, food and drink, hands-on classes", chosen: true}
    - {name: Active and outdoors as well, note: kept at a low weight until a rating raises it}
  why: My choice. Ratings move the weights after each date.
- question: What counts as a repeat?
  options:
    - {name: "Same venue, or same activity kind for classes and experiences", chosen: true}
    - {name: Same venue only, note: allows a second pottery class elsewhere}
    - {name: Same category, note: food runs out after one restaurant}
  why: A new restaurant is a new date, and a second pottery class is not.
- question: Can a past favourite come back?
  options:
    - {name: Only when I ask Muse for one, chosen: true}
    - {name: "Automatically after 6 months", note: weakens the no-repeat rule}
  why: Strict novelty by default.
- question: When does a splurge appear?
  options:
    - {name: "One splurge idea in the Shortlist each month, until one is booked", chosen: true}
    - {name: Only when I ask}
    - {name: The first week of each month}
  why: The monthly big date happens without me asking.
- question: What if none of the three ideas fits?
  options:
    - {name: "Muse sends the next three, at most two more rounds", chosen: true}
    - {name: Skip the week}
  why: Rejected ideas lose some score but stay in the list.
- question: Can I add my own finds?
  options:
    - {name: I forward a link to Muse and it becomes a saved idea with a boost, chosen: true}
    - {name: Only in the web app}
  why: Reels and tips from friends reach me on the phone.
- question: Do ideas that end soon rank higher?
  options:
    - {name: No boost, chosen: true}
    - {name: Boost ideas ending within 4 weeks}
  why: My choice. Taste and novelty decide the order.
- question: Which part does Muse drive?
  options:
    - {name: "Muse runs the weekly routine: shortlist, availability, my pick, booking, rating", chosen: true}
    - {name: Muse books only and the app messages me, note: needs the unused delegate path}
    - {name: The app checks availability itself, note: headless browsers get blocked}
  why: Muse already has a scheduler, a real browser with my sign-ins, and my WhatsApp chat.
- question: Where does the app run?
  options:
    - {name: Infra path with the tanstack_app module, chosen: true}
    - {name: Cloud with cloud new, note: Actual Budget, Immich and claude-agent-service are in-cluster only}
  why: The app reads in-cluster services that Cloud apps cannot reach.
- question: Which model finds ideas?
  options:
    - {name: claude-agent-service on the existing subscription, chosen: true}
    - {name: Anthropic API, note: new spend}
    - {name: Free OpenRouter models, note: weaker web research}
  why: It already runs agents for nextcloud-todos at no new cost.
```

## How a week runs

1. Sunday 20:00: the app starts the date-scout agent. The agent reads the listing sites and returns new ideas with price, area and link.
2. The app drops each repeat and scores the rest on taste, novelty, budget and distance from Clerkenwell.
3. The app finds a free evening in the next week. A trip in TripIt or the calendar makes it a skipped week.
4. Monday 09:00: Muse gets the shortlist and the evening from the app.
5. Muse checks availability in its browser. Muse replaces an idea that has no table or ticket.
6. Muse sends me three ideas on WhatsApp. I reply with one number, or "none" for the next three.
7. Muse books with a `<place>@viktorbarzin.me` email and asks me before it pays. Muse posts the booking back to the app.
8. The app puts the date on my Nextcloud calendar and sends my partner the surprise hold.
9. The morning after the date, Muse asks for a rating from 1 to 5 and one line on what we liked.

I can forward Muse a link at any time, and Muse saves it as an idea. I can also ask Muse for a past favourite.

The repo holds `GLOSSARY.md` and ADR 0001, which records why Muse drives the week. The repo is public, so the code holds no names. My partner's name and my home area live in Vault. Muse calls `/api/muse` with one bearer token. Muse reads the token from Vault through its homelab access, so the token never goes into a chat.

## Order of work

```timeline
caption: each step comes out with its own rollback; a booking needs my approval in WhatsApp
steps:
  - {when: step 1, what: "repo viktor/datenight from app-template, repeat rule and score with tests first", rollback: delete the repo}
  - {when: step 2, what: "dbaas, vault and stacks/datenight applied; only me in Date Night Users", rollback: destroy the stack}
  - {when: step 3, what: "history import from Calendar, Actual Budget and Immich; I confirm past dates in the app", rollback: delete the imported rows}
  - {when: step 3b, what: "free-evening finder, trip skip and the surprise hold, tested with a hold to a spam@ alias", rollback: revert the commit}
  - {when: step 4, what: "date-scout agent and the Sunday cron; first real scout run", rollback: remove the cron and the agent file}
  - {when: step 5, what: "Muse API, its token in Vault and the routine brief at /muse/brief", rollback: remove the token from Vault}
  - {when: step 6, what: "first real Monday with a real booking", ponr: true}
```

## Configuration

```config
- {key: secret/datenight, where: Vault KV, old: "none", new: "better_auth_secret, oidc client, muse_token, scout_token, owner and partner name and email, home position, feed and API keys"}
- {key: caldav_app_password, where: "Vault secret/nextcloud-todos, read by ESO", old: "used by nextcloud-todos", new: "also read by datenight"}
- {key: frame_api_key, where: "Vault secret/immich, read by ESO", old: "used by the frames", new: "also read by datenight"}
- {key: date-scout.md, where: claude-agent-service agents/, old: "none", new: "web research agent, $1 cap a run"}
- {key: scout cron, where: stacks/datenight, old: "none", new: "0 20 * * 0 UTC"}
- {key: signup_mode, where: stacks/datenight, old: "none", new: "request, only me approved"}
```

## Muse setup

I send Muse one WhatsApp message with the brief link, and Muse builds its own weekly routine from it. The brief page is public and holds no names or secrets.

```sh
https://datenight.viktorbarzin.me/muse/brief
```
