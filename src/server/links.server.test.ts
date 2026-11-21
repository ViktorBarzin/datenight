/**
 * Links and photos against a real Postgres (TEST_DATABASE_URL), with a fake
 * agent answer and a fake web: a venue page with photos, image hosts, and an
 * expiring Instagram thumbnail the app must copy.
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
import * as schema from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { addIdeas } from "./ideas.server";
import type { LinkAnswer } from "./integrations/link.server";
import {
	addLink,
	linkById,
	normalizeLink,
	processLink,
	retryLink,
} from "./links.server";
import { fillPhotos, PHOTO_PREFIX, storedPhoto } from "./photos.server";

const adminUrl = process.env.TEST_DATABASE_URL;
let database: Awaited<ReturnType<typeof migratedTestDatabase>>;
let db: Db;

beforeAll(async () => {
	if (!adminUrl) return;
	database = await migratedTestDatabase({
		adminUrl,
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
		lockKey: app.migrationLockKey,
		prefix: "links_test",
	});
	db = drizzle({ client: database.client, schema });
});

afterAll(async () => {
	if (!adminUrl) return;
	await database.drop();
});

const VENUE_PAGE = `<html><head><meta property="og:image" content="https://img.example/hero.jpg"></head>
<body><img src="https://img.example/room.jpg"><img src="https://img.example/small.jpg"><img src="https://img.example/broken.jpg"></body></html>`;
const BIG = new Uint8Array(40_000);

function web(): Deps["fetch"] {
	return async (url, init) => {
		const method = init?.method ?? "GET";
		if (url === "https://venue.example/")
			return new Response(VENUE_PAGE, {
				headers: { "content-type": "text/html" },
			});
		if (url.startsWith("https://img.example/broken"))
			return new Response("no", { status: 404 });
		if (url.startsWith("https://img.example/small"))
			return new Response(method === "HEAD" ? null : new Uint8Array(500), {
				headers: { "content-type": "image/jpeg", "content-length": "500" },
			});
		if (url.startsWith("https://img.example/"))
			return new Response(method === "HEAD" ? null : BIG, {
				headers: {
					"content-type": "image/jpeg",
					"content-length": String(BIG.length),
				},
			});
		if (url.startsWith("https://scontent.cdninstagram.com/"))
			return new Response(BIG, { headers: { "content-type": "image/jpeg" } });
		return new Response("not found", { status: 404 });
	};
}

function deps(answer: LinkAnswer | Error): Deps {
	return {
		now: () => new Date("2026-11-23T09:00:00Z"),
		settings: {
			museToken: null,
			scout: null,
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
		fetch: web(),
		readLink: async () => {
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
}

const FOUND: LinkAnswer = {
	found: true,
	reason: "",
	idea: {
		title: "Seafood boil with a film",
		venue: "Tasty Crab",
		address: "",
		area: "Shoreditch",
		postcode: "",
		category: "food",
		activity_kind: "seafood boil dinner",
		price_gbp_for_two: 70,
		url: "https://venue.example/",
		booking_url: "",
		description: "",
		why: "Messy and fun.",
		ends_on: null,
	},
	photo_pages: ["https://venue.example/"],
	social: {
		caption: "Tasty Crab boil",
		uploader: "where",
		thumbnails: ["https://scontent.cdninstagram.com/v/thumb.jpg?oe=1"],
	},
};

describe("normalizeLink", () => {
	test("takes the link out of shared text and drops tracking parameters", () => {
		expect(
			normalizeLink(
				"look at this! https://www.instagram.com/reel/ABC/?igsh=xyz&utm_source=ig_web",
			),
		).toBe("https://www.instagram.com/reel/ABC/");
	});
	test("refuses text without a link", () => {
		expect(() => normalizeLink("no link here")).toThrow();
	});
});

describe.skipIf(!adminUrl)("links and photos", () => {
	beforeEach(async () => {
		await db.delete(schema.savedLinks);
		await db.delete(schema.ideas);
		await db.delete(schema.storedPhotos);
	});

	test("a link becomes a saved idea with the post's photo copied first, then real venue photos", async () => {
		const link = await addLink(db, {
			url: "https://www.tiktok.com/@where/video/1?_r=1",
			note: "fun",
			via: "muse",
		});
		await processLink(db, deps(FOUND), link.id);
		const done = await linkById(db, link.id);
		expect(done).toMatchObject({
			status: "done",
			ideaTitle: "Seafood boil with a film",
		});
		const [idea] = await db.select().from(schema.ideas);
		expect(idea?.source).toBe("saved");
		const photos = idea?.photos ?? [];
		expect(photos[0]?.startsWith(PHOTO_PREFIX)).toBe(true);
		expect(photos.slice(1)).toEqual([
			"https://img.example/hero.jpg",
			"https://img.example/room.jpg",
		]);
		const copy = await storedPhoto(
			db,
			(photos[0] ?? "").slice(PHOTO_PREFIX.length),
		);
		expect(copy?.bytes.byteLength).toBe(BIG.length);
	});

	test("the same link sent twice in a day is one record", async () => {
		const a = await addLink(db, {
			url: "https://a.example/x",
			note: "",
			via: "app",
		});
		const b = await addLink(db, {
			url: "https://a.example/x#top",
			note: "",
			via: "muse",
		});
		expect(b.id).toBe(a.id);
	});

	test("a link with no date in it says why", async () => {
		const link = await addLink(db, {
			url: "https://a.example/cat",
			note: "",
			via: "app",
		});
		await processLink(
			db,
			deps({
				found: false,
				reason: "a cat video",
				idea: null,
				photo_pages: [],
				social: null,
			}),
			link.id,
		);
		expect(await linkById(db, link.id)).toMatchObject({
			status: "not_found",
			reason: "a cat video",
		});
	});

	test("a failed read can be tried again", async () => {
		const link = await addLink(db, {
			url: "https://a.example/y",
			note: "",
			via: "app",
		});
		await processLink(db, deps(new Error("agent down")), link.id);
		expect((await linkById(db, link.id))?.status).toBe("failed");
		await retryLink(db, link.id);
		await processLink(db, deps(FOUND), link.id);
		expect((await linkById(db, link.id))?.status).toBe("done");
	});

	test("the photo crawl fills ideas that were never looked at, and marks a page with none", async () => {
		await addIdeas(
			db,
			deps(FOUND),
			[
				{
					title: "A",
					venue: "Venue A",
					category: "food",
					activityKind: "dinner",
					priceGbp: 50,
					url: "https://venue.example/",
				},
				{
					title: "B",
					venue: "Venue B",
					category: "food",
					activityKind: "dinner",
					priceGbp: 50,
					url: "https://gone.example/",
				},
			],
			"scout",
		);
		expect(await fillPhotos(db, deps(FOUND), 10)).toBe(2);
		const rows = await db.select().from(schema.ideas);
		const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.photos]));
		expect(byTitle.A).toEqual([
			"https://img.example/hero.jpg",
			"https://img.example/room.jpg",
		]);
		expect(byTitle.B).toEqual([]);
		expect(await fillPhotos(db, deps(FOUND), 10)).toBe(0);
	});
});
