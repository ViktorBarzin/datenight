import { describe, expect, test } from "bun:test";

import { isRepeat, normalizeName, sameActivityKind, sameVenue } from "./repeat";
import type { PastDateFacts } from "./types";

const past = (over: Partial<PastDateFacts>): PastDateFacts => ({
	venue: "Somewhere",
	activityKind: "dinner",
	category: "food",
	on: "2026-01-01",
	rating: null,
	...over,
});

describe("normalizeName", () => {
	test.each([
		["The Lost Estate", "lost estate"],
		["Café Murano, London", "cafe murano"],
		["BAB N SUUL", "bab n suul"],
		["  Dishoom   King's Cross ", "dishoom kings cross"],
	])("%p -> %p", (input, expected) => {
		expect(normalizeName(input)).toBe(expected);
	});
});

describe("sameVenue", () => {
	test("equal after normalising", () => {
		expect(sameVenue("The Barbican", "barbican")).toBe(true);
	});
	test("another branch of the same place counts", () => {
		expect(sameVenue("Dishoom Shoreditch", "Dishoom")).toBe(true);
		expect(sameVenue("Dishoom", "Dishoom King's Cross")).toBe(true);
	});
	test("a shared word is not enough", () => {
		expect(sameVenue("The Old Vic", "The Young Vic")).toBe(false);
		expect(sameVenue("Bar Termini", "Bar Italia")).toBe(false);
	});
	test("empty names never match", () => {
		expect(sameVenue("", "")).toBe(false);
	});
});

describe("sameActivityKind", () => {
	test.each([
		["pottery class", "Pottery classes", true],
		["pottery wheel class", "pottery class", true],
		["immersive dinner theatre", "immersive theatre", true],
		["cocktail making class", "chocolate making class", false],
		["comedy show", "magic show", false],
		["jazz club", "jazz brunch", false],
	])("%p vs %p is %p", (a, b, expected) => {
		expect(sameActivityKind(a, b)).toBe(expected);
	});
});

describe("isRepeat", () => {
	test("a past venue is a repeat in any category", () => {
		const idea = {
			venue: "BAB N SUUL",
			activityKind: "korean bbq",
			category: "food" as const,
		};
		expect(isRepeat(idea, [past({ venue: "Bab N Suul" })])).toBe(true);
	});

	test("a new restaurant is never a repeat, whatever its kind", () => {
		const idea = {
			venue: "Kiln",
			activityKind: "dinner",
			category: "food" as const,
		};
		expect(
			isRepeat(idea, [past({ venue: "Smoking Goat", activityKind: "dinner" })]),
		).toBe(false);
	});

	test("a class of a done kind is a repeat at a new venue", () => {
		const idea = {
			venue: "Turning Earth",
			activityKind: "pottery wheel class",
			category: "classes" as const,
		};
		const done = past({
			venue: "Clay Studio",
			activityKind: "pottery class",
			category: "classes",
		});
		expect(isRepeat(idea, [done])).toBe(true);
	});

	test("a show of a done kind is a repeat even when the past date was filed under food", () => {
		const idea = {
			venue: "Gatsby's Drugstore",
			activityKind: "immersive dinner theatre",
			category: "shows" as const,
		};
		const done = past({
			venue: "58th Street",
			activityKind: "immersive dinner theatre",
			category: "shows",
		});
		expect(isRepeat(idea, [done])).toBe(true);
	});

	test("a food past date never blocks a kind", () => {
		const idea = {
			venue: "Pasta Evangelists",
			activityKind: "dinner",
			category: "classes" as const,
		};
		expect(
			isRepeat(idea, [
				past({ venue: "Padella", activityKind: "dinner", category: "food" }),
			]),
		).toBe(false);
	});
});
