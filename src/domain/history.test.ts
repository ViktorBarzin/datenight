import { describe, expect, test } from "bun:test";

import {
	awayDays,
	candidatesFrom,
	isSpendCandidate,
	venueFromSummary,
} from "./history";

describe("venueFromSummary", () => {
	test.each([
		["Dinner at BAB N SUUL", "BAB N SUUL"],
		["Drinks @ Nightjar", "Nightjar"],
		["58th Street - anniversary", "58th Street"],
		["Pottery class", "Pottery class"],
	])("%p -> %p", (summary, venue) => {
		expect(venueFromSummary(summary)).toBe(venue);
	});
});

describe("isSpendCandidate", () => {
	test("a restaurant bill counts", () => {
		expect(isSpendCandidate({ payee: "Bab N Suul", amountPence: -6400 })).toBe(
			true,
		);
	});
	test("small amounts, refunds and subscriptions do not", () => {
		expect(isSpendCandidate({ payee: "Pret", amountPence: -800 })).toBe(false);
		expect(isSpendCandidate({ payee: "Bab N Suul", amountPence: 6400 })).toBe(
			false,
		);
		expect(
			isSpendCandidate({ payee: "Youtube Premium", amountPence: -2500 }),
		).toBe(false);
		expect(isSpendCandidate({ payee: "Atm", amountPence: -5000 })).toBe(false);
	});
});

describe("candidatesFrom", () => {
	test("evidence on the same day merges into one candidate with the best venue guess", () => {
		const out = candidatesFrom({
			events: [
				{
					on: "2026-10-28",
					startHour: 19,
					summary: "Dinner at BAB N SUUL",
					location: "1 Gerrard Place",
				},
			],
			spends: [
				{
					on: "2026-10-28",
					payee: "Metodi Istatkov",
					notes: "Bab N Suul",
					amountPence: -14100,
				},
			],
			photoDays: [{ on: "2026-10-28", count: 12, places: ["London"] }],
		});
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			on: "2026-10-28",
			venueGuess: "BAB N SUUL",
		});
		expect(out[0]?.evidence.map((e) => e.source)).toEqual([
			"calendar",
			"bank",
			"photos",
		]);
	});

	test("a daytime calendar event alone is not a candidate", () => {
		const out = candidatesFrom({
			events: [
				{ on: "2026-10-28", startHour: 10, summary: "Dentist", location: "" },
			],
			spends: [],
			photoDays: [],
		});
		expect(out).toEqual([]);
	});

	test("a few photos alone are not a candidate, many are", () => {
		const few = candidatesFrom({
			events: [],
			spends: [],
			photoDays: [{ on: "2026-10-01", count: 3, places: [] }],
		});
		const many = candidatesFrom({
			events: [],
			spends: [],
			photoDays: [{ on: "2026-10-01", count: 9, places: ["London"] }],
		});
		expect(few).toEqual([]);
		expect(many).toHaveLength(1);
	});

	test("newest first", () => {
		const out = candidatesFrom({
			events: [],
			spends: [
				{ on: "2026-01-01", payee: "A", notes: "", amountPence: -3000 },
				{ on: "2026-02-01", payee: "B", notes: "", amountPence: -3000 },
			],
			photoDays: [],
		});
		expect(out.map((c) => c.on)).toEqual(["2026-02-01", "2026-01-01"]);
	});
});

describe("awayDays", () => {
	test("every London day a trip touches in the evening", () => {
		const days = awayDays([
			{
				start: new Date("2026-11-02T06:15:00Z"),
				end: new Date("2026-11-02T19:00:00Z"),
			},
			{
				start: new Date("2026-11-03T00:00:00Z"),
				end: new Date("2026-11-05T00:00:00Z"),
			},
		]);
		expect([...days].sort()).toEqual([
			"2026-11-02",
			"2026-11-03",
			"2026-11-04",
		]);
	});
	test("a morning flight home leaves that evening in London", () => {
		const days = awayDays([
			{
				start: new Date("2026-11-15T02:00:00Z"),
				end: new Date("2026-11-15T09:00:00Z"),
			},
		]);
		expect([...days]).toEqual([]);
	});
});
