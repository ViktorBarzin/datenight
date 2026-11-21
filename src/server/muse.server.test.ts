import { describe, expect, test } from "bun:test";

import type { Deps } from "./deps.server";
import { handleMuse } from "./muse.server";

function deps(museToken: string | null): Deps {
	return {
		now: () => new Date("2026-11-23T09:00:00Z"),
		settings: {
			museToken,
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
		fetch: async () => new Response("not found", { status: 404 }),
		readLink: async () => {
			throw new Error("no link reader in this test");
		},
	};
}

const req = (path: string, init: RequestInit = {}) =>
	new Request(`http://app/api/muse/${path}`, init);

describe("handleMuse", () => {
	test("503 while no token is set up", async () => {
		const res = await handleMuse(req("week"), "week", deps(null));
		expect(res.status).toBe(503);
		expect((await res.json()).error.code).toBe("not_configured");
	});

	test("401 without the token or with a wrong one", async () => {
		expect((await handleMuse(req("week"), "week", deps("secret"))).status).toBe(
			401,
		);
		const wrong = req("week", { headers: { authorization: "Bearer nope" } });
		expect((await handleMuse(wrong, "week", deps("secret"))).status).toBe(401);
	});

	test("404 for an unknown route or method, with the right token", async () => {
		const auth = { authorization: "Bearer secret" };
		const unknown = await handleMuse(
			req("nope", { headers: auth }),
			"nope",
			deps("secret"),
		);
		expect(unknown.status).toBe(404);
		const wrongMethod = await handleMuse(
			req("week/next", { headers: auth }),
			"week/next",
			deps("secret"),
		);
		expect(wrongMethod.status).toBe(404);
	});

	test("400 for a malformed id and 422 for a malformed body, before any database work", async () => {
		const auth = {
			authorization: "Bearer secret",
			"content-type": "application/json",
		};
		const badId = await handleMuse(
			req("dates/not-a-uuid/rating", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ happened: false }),
			}),
			"dates/not-a-uuid/rating",
			deps("secret"),
		);
		expect(badId.status).toBe(400);
		const badBody = await handleMuse(
			req("bookings", {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ idea_id: "x" }),
			}),
			"bookings",
			deps("secret"),
		);
		expect(badBody.status).toBe(422);
	});
});
