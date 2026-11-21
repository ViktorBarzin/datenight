/**
 * The weekly flow against a real Postgres (TEST_DATABASE_URL) with fake
 * calendars: Scout ideas in, a Shortlist out, a new round, a booking with
 * its two calendar events, a Rating, and the repeat rule afterwards.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { resolve } from "node:path";
import { migratedTestDatabase } from "@viktorbarzin/pg/testing";
import { drizzle } from "drizzle-orm/bun-sql";

import { app } from "#/app.config";
import type { Interval } from "#/domain/evening";
import { parseEvents } from "#/domain/ical";
import {
	addPastDate,
	awaitingRating,
	book,
	cancel,
	rate,
} from "./dates.server";
import * as schema from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { addIdeas, type NewIdea } from "./ideas.server";
import { currentWeek, nextRound, replaceIdea } from "./week.server";

const adminUrl = process.env.TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
let db: Db;

beforeAll(async () => {
	if (!adminUrl) return;
	database = await migratedTestDatabase({
		adminUrl,
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
		lockKey: app.migrationLockKey,
		prefix: "flow_test",
	});
	db = drizzle({ client: database.client, schema });
});

afterAll(async () => {
	if (!adminUrl) return;
	await database.drop();
});

interface Fake {
	deps: Deps;
	events: Map<string, string>;
	now: { value: Date };
	busy: Interval[];
	trips: Interval[];
}

function fake(): Fake {
	const events = new Map<string, string>();
	const now = { value: new Date("2026-11-23T09:00:00Z") }; // a Monday
	const f: Fake = {
		events,
		now,
		busy: [],
		trips: [],
		deps: {
			now: () => now.value,
			settings: {
				museToken: "t",
				scout: null,
				caldav: null,
				owner: { name: "Owner", email: "owner@example.com" },
				partner: { name: "Partner", email: "partner@example.com" },
				actual: null,
				immich: null,
				tripitFeedUrl: null,
				home: { lat: 51.5257, lon: -0.0875 },
				historySince: "2022-08-05",
				schedulerEnabled: false,
			},
			busy: async () => f.busy,
			trips: async () => f.trips,
			hints: async () => [],
			putEvent: async (uid, ics) => {
				events.set(uid, ics);
			},
			deleteEvent: async (uid) => {
				events.delete(uid);
			},
			geocode: async () => new Map(),
		},
	};
	return f;
}

const idea = (venue: string, over: Partial<NewIdea> = {}): NewIdea => ({
	title: `${venue} evening`,
	venue,
	category: "food",
	activityKind: "dinner",
	priceGbp: 60,
	area: "Soho",
	...over,
});

async function reset(): Promise<void> {
	await db.delete(schema.shortlists);
	await db.delete(schema.dates);
	await db.delete(schema.ideas);
}

describe.skipIf(!adminUrl)("the weekly flow", () => {
	beforeEach(reset);

	test("a shortlist of three for Tuesday next week, the same on every ask", async () => {
		const f = fake();
		await addIdeas(
			db,
			f.deps,
			[
				idea("Kiln"),
				idea("Sadler's Wells", {
					category: "shows",
					activityKind: "flamenco show",
				}),
				idea("Turning Earth", {
					category: "classes",
					activityKind: "pottery class",
				}),
				idea("Padella"),
			],
			"scout",
		);
		const week = await currentWeek(db, f.deps);
		expect(week.weekStart).toBe("2026-11-30");
		expect(week.evening?.date).toBe("2026-12-01");
		expect(week.evening?.startsAt).toBe("2026-12-01T19:00:00.000Z");
		expect(week.ideas).toHaveLength(3);
		expect(new Set(week.ideas.map((i) => i.category)).size).toBe(3);
		const again = await currentWeek(db, f.deps);
		expect(again.ideas.map((i) => i.id)).toEqual(week.ideas.map((i) => i.id));
	});

	test("a trip makes a skipped week", async () => {
		const f = fake();
		f.trips = [
			{
				start: new Date("2026-11-28T00:00:00Z"),
				end: new Date("2026-12-07T00:00:00Z"),
			},
		];
		await addIdeas(db, f.deps, [idea("Kiln")], "scout");
		const week = await currentWeek(db, f.deps);
		expect(week).toMatchObject({
			status: "skipped",
			skipReason: "travel",
			ideas: [],
		});
	});

	test("two more rounds, never repeating an idea, then exhausted", async () => {
		const f = fake();
		await addIdeas(
			db,
			f.deps,
			Array.from({ length: 8 }, (_, i) => idea(`Place ${i}`)),
			"scout",
		);
		const first = await currentWeek(db, f.deps);
		const second = await nextRound(db, f.deps);
		const third = await nextRound(db, f.deps);
		const seen = [...first.ideas, ...second.ideas, ...third.ideas].map(
			(i) => i.id,
		);
		expect(new Set(seen).size).toBe(seen.length);
		expect(third.roundsLeft).toBe(0);
		const done = await nextRound(db, f.deps);
		expect(done.status).toBe("exhausted");
	});

	test("an unavailable idea is swapped without a penalty", async () => {
		const f = fake();
		await addIdeas(
			db,
			f.deps,
			Array.from({ length: 5 }, (_, i) => idea(`Place ${i}`)),
			"scout",
		);
		const week = await currentWeek(db, f.deps);
		const gone = week.ideas[1]?.id ?? "";
		const swapped = await replaceIdea(db, f.deps, gone);
		expect(swapped.ideas).toHaveLength(3);
		expect(swapped.ideas.map((i) => i.id)).not.toContain(gone);
		expect(swapped.round).toBe(0);
	});

	test("booking adds the owner's event and a surprise hold that hides the venue", async () => {
		const f = fake();
		await addIdeas(db, f.deps, [idea("Kiln", { area: "Soho" })], "scout");
		const week = await currentWeek(db, f.deps);
		const chosen = week.ideas[0];
		if (!chosen) throw new Error("no idea");
		const date = await book(db, f.deps, {
			ideaId: chosen.id,
			startsAt: new Date("2026-12-01T19:30:00Z"),
			endsAt: null,
			bookingRef: "ABC123",
			bookingPlatform: "OpenTable",
			bookingEmail: "kiln@example.com",
			priceGbp: 70,
			dressCode: "casual",
			notes: "",
		});
		expect(date).toMatchObject({
			status: "booked",
			venue: "Kiln",
			calendar: "added",
			on: "2026-12-01",
		});
		const hold = f.events.get(`hold-${date.id}@datenight`) ?? "";
		const own = f.events.get(`date-${date.id}@datenight`) ?? "";
		expect(parseEvents(own)[0]?.summary).toBe("Date: Kiln");
		expect(parseEvents(hold)[0]?.summary).toBe("Surprise date");
		expect(hold).not.toContain("Kiln");
		expect(hold.replace(/\r\n /g, "")).toContain("mailto:partner@example.com");
		expect((await currentWeek(db, f.deps)).status).toBe("booked");

		f.now.value = new Date("2026-12-02T09:00:00Z");
		expect((await awaitingRating(db, f.deps)).map((d) => d.id)).toEqual([
			date.id,
		]);
		const rated = await rate(db, date.id, {
			happened: true,
			rating: 5,
			note: "loved the bread",
		});
		expect(rated).toMatchObject({ status: "done", rating: 5 });
		expect(await awaitingRating(db, f.deps)).toEqual([]);
	});

	test("cancelling removes both events and reopens the idea", async () => {
		const f = fake();
		await addIdeas(db, f.deps, [idea("Kiln")], "scout");
		const week = await currentWeek(db, f.deps);
		const date = await book(db, f.deps, {
			ideaId: week.ideas[0]?.id ?? "",
			startsAt: new Date("2026-12-01T19:30:00Z"),
			endsAt: null,
			bookingRef: "",
			bookingPlatform: "",
			bookingEmail: "",
			priceGbp: null,
			dressCode: "",
			notes: "",
		});
		await cancel(db, f.deps, date.id);
		expect(f.events.size).toBe(0);
		expect((await currentWeek(db, f.deps)).status).toBe("offered");
	});

	test("a confirmed past date makes matching ideas repeats", async () => {
		const f = fake();
		await addPastDate(db, {
			on: "2026-03-01",
			venue: "Clay Studio",
			activityKind: "pottery class",
			category: "classes",
			rating: 4,
			note: "",
		});
		const added = await addIdeas(
			db,
			f.deps,
			[
				idea("Turning Earth", {
					category: "classes",
					activityKind: "pottery wheel class",
				}),
				idea("Kiln"),
			],
			"scout",
		);
		expect(added).toMatchObject({ added: 1, repeats: 1 });
		const week = await currentWeek(db, f.deps);
		expect(week.ideas.map((i) => i.venue)).toEqual(["Kiln"]);
	});

	test("a splurge appears only while none is booked that month", async () => {
		const f = fake();
		await addIdeas(
			db,
			f.deps,
			[
				idea("Cheap A"),
				idea("Cheap B", { category: "shows", activityKind: "comedy" }),
				idea("Cheap C", { category: "classes", activityKind: "life drawing" }),
				idea("Fancy", {
					category: "shows",
					activityKind: "immersive dinner theatre",
					priceGbp: 300,
				}),
			],
			"scout",
		);
		const week = await currentWeek(db, f.deps);
		expect(week.ideas.some((i) => i.splurge)).toBe(true);

		await reset();
		await addPastDate(db, {
			on: "2026-12-10",
			venue: "Old splurge",
			activityKind: "tasting menu",
			category: "food",
			rating: 5,
			note: "",
		});
		await db.update(schema.dates).set({ priceGbp: 200 });
		await addIdeas(
			db,
			f.deps,
			[
				idea("Cheap A"),
				idea("Fancy", {
					category: "shows",
					activityKind: "opera",
					priceGbp: 300,
				}),
			],
			"scout",
		);
		const later = await currentWeek(db, f.deps);
		expect(later.ideas.some((i) => i.splurge)).toBe(false);
	});

	test("a saved idea that the scout already knows keeps one row and gets the boost", async () => {
		const f = fake();
		await addIdeas(db, f.deps, [idea("Kiln")], "scout");
		const saved = await addIdeas(db, f.deps, [idea("Kiln")], "saved");
		expect(saved).toMatchObject({ added: 0, duplicates: 1 });
		const rows = await db.select().from(schema.ideas);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.source).toBe("saved");
	});
});
