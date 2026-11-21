import { describe, expect, test } from "bun:test";

import { distanceKm, pickShortlist, scoreIdea, tasteWeights } from "./rank";
import type { Category, IdeaFacts } from "./types";

const idea = (over: Partial<IdeaFacts>): IdeaFacts => ({
	id: over.id ?? crypto.randomUUID(),
	title: "An idea",
	venue: "A venue",
	activityKind: "something",
	category: "food",
	priceGbp: 60,
	lat: null,
	lon: null,
	saved: false,
	liked: false,
	rejections: 0,
	text: "",
	...over,
});

const neutral = {
	weights: tasteWeights([]),
	lastByCategory: {} as Partial<Record<Category, string>>,
	today: "2026-11-23",
	home: null,
	hints: [] as string[],
};

describe("tasteWeights", () => {
	test("starts with the three favoured categories ahead of active", () => {
		const w = tasteWeights([]);
		expect(w.shows).toBe(1);
		expect(w.food).toBe(1);
		expect(w.classes).toBe(1);
		expect(w.active).toBeLessThan(0.5);
	});
	test("a 5 raises a category and a 1 lowers it", () => {
		const w = tasteWeights([
			{ category: "classes", rating: 5 },
			{ category: "food", rating: 1 },
		]);
		expect(w.classes).toBeGreaterThan(1);
		expect(w.food).toBeLessThan(1);
	});
	test("swipes nudge a category a third as much as a rating", () => {
		const rated = tasteWeights([{ category: "classes", rating: 4 }]);
		const swiped = tasteWeights([], [{ category: "classes", liked: true }]);
		expect(swiped.classes - 1).toBeCloseTo((rated.classes - 1) / 3, 5);
		const passed = tasteWeights([], [{ category: "food", liked: false }]);
		expect(passed.food).toBeLessThan(1);
	});
	test("stays within bounds", () => {
		const many = Array.from({ length: 50 }, () => ({
			category: "shows" as const,
			rating: 1,
		}));
		expect(tasteWeights(many).shows).toBeGreaterThan(0);
	});
});

describe("distanceKm", () => {
	test("Old Street to Peckham is about 7 km", () => {
		const d = distanceKm(
			{ lat: 51.5257, lon: -0.0875 },
			{ lat: 51.4693, lon: -0.0694 },
		);
		expect(d).toBeGreaterThan(6);
		expect(d).toBeLessThan(7.5);
	});
});

describe("scoreIdea", () => {
	test("a favoured category beats active", () => {
		expect(scoreIdea(idea({ category: "shows" }), neutral)).toBeGreaterThan(
			scoreIdea(idea({ category: "active" }), neutral),
		);
	});
	test("a category not done for a while beats one done last week", () => {
		const ctx = {
			...neutral,
			lastByCategory: { food: "2026-11-17", shows: "2026-06-01" },
		};
		expect(scoreIdea(idea({ category: "shows" }), ctx)).toBeGreaterThan(
			scoreIdea(idea({ category: "food" }), ctx),
		);
	});
	test("a saved idea gets a boost and each rejection costs", () => {
		const base = scoreIdea(idea({}), neutral);
		expect(scoreIdea(idea({ saved: true }), neutral)).toBeGreaterThan(base);
		expect(scoreIdea(idea({ rejections: 2 }), neutral)).toBeLessThan(base);
	});
	test("nearer is better", () => {
		const ctx = { ...neutral, home: { lat: 51.5257, lon: -0.0875 } };
		const near = idea({ lat: 51.522, lon: -0.09 });
		const far = idea({ lat: 51.41, lon: -0.3 });
		expect(scoreIdea(near, ctx)).toBeGreaterThan(scoreIdea(far, ctx));
	});
	test("an idea that matches a Noticing File hint gets a boost", () => {
		const ctx = { ...neutral, hints: ["she wants to try flamenco"] };
		expect(
			scoreIdea(idea({ text: "Flamenco night in Soho" }), ctx),
		).toBeGreaterThan(scoreIdea(idea({ text: "Salsa night in Soho" }), ctx));
	});
});

describe("pickShortlist", () => {
	const ranked = [
		idea({ id: "f1", category: "food" }),
		idea({ id: "f2", category: "food" }),
		idea({ id: "s1", category: "shows" }),
		idea({ id: "c1", category: "classes" }),
		idea({ id: "x1", category: "shows", priceGbp: 160 }),
	];

	test("three ideas from different categories, in rank order", () => {
		expect(pickShortlist(ranked, { splurgeAllowed: false })).toEqual([
			"f1",
			"s1",
			"c1",
		]);
	});

	test("no splurge when one was booked this month", () => {
		const onlySplurgeShows = ranked.filter((i) => i.id !== "s1");
		expect(pickShortlist(onlySplurgeShows, { splurgeAllowed: false })).toEqual([
			"f1",
			"c1",
			"f2",
		]);
	});

	test("one splurge takes the last place when allowed", () => {
		expect(pickShortlist(ranked, { splurgeAllowed: true })).toEqual([
			"f1",
			"s1",
			"x1",
		]);
	});

	test("liked ideas take the places first, best first, then the usual pick", () => {
		const withLikes = [
			idea({ id: "f1", category: "food" }),
			idea({ id: "s1", category: "shows" }),
			idea({ id: "c1", category: "classes" }),
			idea({ id: "lf", category: "food", liked: true }),
			idea({ id: "lf2", category: "food", liked: true }),
		];
		expect(pickShortlist(withLikes, { splurgeAllowed: false })).toEqual([
			"lf",
			"lf2",
			"s1",
		]);
	});

	test("a liked splurge still waits for a month without one", () => {
		const likedSplurge = [
			idea({ id: "f1" }),
			idea({ id: "x", priceGbp: 200, liked: true }),
		];
		expect(pickShortlist(likedSplurge, { splurgeAllowed: false })).toEqual([
			"f1",
		]);
		expect(pickShortlist(likedSplurge, { splurgeAllowed: true })).toEqual([
			"f1",
			"x",
		]);
	});

	test("skips excluded ideas", () => {
		expect(
			pickShortlist(ranked, {
				splurgeAllowed: false,
				exclude: new Set(["f1", "s1", "c1"]),
			}),
		).toEqual(["f2"]);
	});
});
