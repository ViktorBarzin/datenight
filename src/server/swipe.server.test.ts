/** The swipe deck against a real Postgres (TEST_DATABASE_URL). */
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
import * as schema from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { addIdeas, listIdeas, type NewIdea } from "./ideas.server";
import { deck, swipe, undoSwipe } from "./swipe.server";
import { currentWeek } from "./week.server";

const adminUrl = process.env.TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
let db: Db;

beforeAll(async () => {
	if (!adminUrl) return;
	database = await migratedTestDatabase({
		adminUrl,
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
		lockKey: app.migrationLockKey,
		prefix: "swipe_test",
	});
	db = drizzle({ client: database.client, schema });
});

afterAll(async () => {
	if (!adminUrl) return;
	await database.drop();
});

function deps(scout: { url: string; token: string } | null = null): Deps {
	return {
		now: () => new Date("2026-11-23T09:00:00Z"),
		settings: {
			museToken: null,
			// Port 9 refuses at once, so a refill run fails fast without the network.
			scout,
			link: null,
			caldav: null,
			owner: null,
			partner: null,
			actual: null,
			immich: null,
			tripitFeedUrl: null,
			home: null,
			historySince: "2022-08-05",
			schedulerEnabled: false,
		},
		busy: async () => [],
		trips: async () => [],
		hints: async () => [],
		putEvent: async () => {},
		deleteEvent: async () => {},
		geocode: async () => new Map(),
		fetch: async () => new Response("not found", { status: 404 }),
		readLink: async () => {
			throw new Error("no link reader in this test");
		},
	};
}

const idea = (venue: string, over: Partial<NewIdea> = {}): NewIdea => ({
	title: `${venue} evening`,
	venue,
	category: "food",
	activityKind: "dinner",
	priceGbp: 60,
	...over,
});

describe.skipIf(!adminUrl)("the swipe deck", () => {
	beforeEach(async () => {
		await db.delete(schema.shortlists);
		await db.delete(schema.jobRuns);
		await db.delete(schema.ideas);
	});

	test("a pass never comes back, a like goes on the Liked list, and undo restores it", async () => {
		const d = deps();
		await addIdeas(db, d, [idea("A"), idea("B"), idea("C")], "scout");
		const first = await deck(db, d, 10);
		expect(first.left).toBe(3);
		const [a, b] = first.ideas;
		if (!a || !b) throw new Error("deck too short");
		await swipe(db, d, a.id, "pass");
		await swipe(db, d, b.id, "like");
		const after = await deck(db, d, 10);
		expect(after.left).toBe(1);
		expect(after.ideas.map((i) => i.id)).not.toContain(a.id);
		expect((await listIdeas(db, "liked", 10)).map((r) => r.id)).toEqual([b.id]);
		expect((await listIdeas(db, "dismissed", 10)).map((r) => r.id)).toEqual([
			a.id,
		]);
		await undoSwipe(db, a.id);
		expect((await deck(db, d, 10)).left).toBe(2);
	});

	test("a liked idea comes first in the shortlist, and a passed one never shows", async () => {
		const d = deps();
		await addIdeas(
			db,
			d,
			[
				idea("Best", { category: "shows", activityKind: "comedy" }),
				idea("Second", { category: "classes", activityKind: "pottery" }),
				idea("Liked"),
				idea("Passed", { category: "active", activityKind: "climbing" }),
			],
			"scout",
		);
		const rows = await db.select().from(schema.ideas);
		const id = (venue: string) => rows.find((r) => r.venue === venue)?.id ?? "";
		await swipe(db, d, id("Liked"), "like");
		await swipe(db, d, id("Passed"), "pass");
		const week = await currentWeek(db, d);
		expect(week.ideas[0]?.venue).toBe("Liked");
		expect(week.ideas.map((i) => i.venue)).not.toContain("Passed");
	});

	test("a swipe that leaves under ten starts one refill a day", async () => {
		const d = deps({ url: "http://127.0.0.1:9/scout", token: "t" });
		await addIdeas(db, d, [idea("A"), idea("B")], "scout");
		const rows = await db.select().from(schema.ideas);
		const first = await swipe(db, d, rows[0]?.id ?? "", "like");
		expect(first).toEqual({ left: 1, refilling: true });
		const second = await swipe(db, d, rows[1]?.id ?? "", "like");
		expect(second.refilling).toBe(false);
		const runs = await db.select().from(schema.jobRuns);
		expect(runs.map((r) => r.periodKey)).toEqual(["refill-2026-11-23"]);
	});
});
