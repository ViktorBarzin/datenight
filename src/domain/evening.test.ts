import { describe, expect, test } from "bun:test";

import { chooseEvening, londonTime, nextWeekMonday } from "./evening";

describe("londonTime", () => {
	test("winter is GMT", () => {
		expect(londonTime("2026-12-01", "19:00").toISOString()).toBe(
			"2026-12-01T19:00:00.000Z",
		);
	});
	test("summer is BST, an hour ahead", () => {
		expect(londonTime("2026-07-01", "19:00").toISOString()).toBe(
			"2026-07-01T18:00:00.000Z",
		);
	});
});

describe("nextWeekMonday", () => {
	test("from a Monday, the Monday a week later", () => {
		expect(nextWeekMonday(new Date("2026-11-23T09:00:00Z"))).toBe("2026-11-30");
	});
	test("from a Saturday, the Monday after the coming one", () => {
		expect(nextWeekMonday(new Date("2026-11-21T14:00:00Z"))).toBe("2026-11-30");
	});
	test("from a Sunday night, eight days on", () => {
		expect(nextWeekMonday(new Date("2026-11-22T20:00:00Z"))).toBe("2026-11-30");
	});
});

const at = (iso: string) => new Date(iso);

describe("chooseEvening", () => {
	const monday = "2026-11-30";

	test("Tuesday when it is free", () => {
		expect(chooseEvening(monday, [], [])).toEqual({ date: "2026-12-01" });
	});

	test("Wednesday when Tuesday evening is busy", () => {
		const busy = [
			{ start: at("2026-12-01T18:00:00Z"), end: at("2026-12-01T21:00:00Z") },
		];
		expect(chooseEvening(monday, busy, [])).toEqual({ date: "2026-12-02" });
	});

	test("a busy Tuesday morning does not block the evening", () => {
		const busy = [
			{ start: at("2026-12-01T09:00:00Z"), end: at("2026-12-01T17:00:00Z") },
		];
		expect(chooseEvening(monday, busy, [])).toEqual({ date: "2026-12-01" });
	});

	test("Monday, then Friday, when Tuesday and Wednesday are busy; never Thursday", () => {
		const tueWed = [
			{ start: at("2026-12-01T19:00:00Z"), end: at("2026-12-01T22:00:00Z") },
			{ start: at("2026-12-02T19:00:00Z"), end: at("2026-12-02T22:00:00Z") },
		];
		expect(chooseEvening(monday, tueWed, [])).toEqual({ date: "2026-11-30" });
		const alsoMonday = [
			...tueWed,
			{ start: at("2026-11-30T19:00:00Z"), end: at("2026-11-30T22:00:00Z") },
		];
		expect(chooseEvening(monday, alsoMonday, [])).toEqual({
			date: "2026-12-04",
		});
	});

	test("a busy week skips as busy", () => {
		const all = [
			{ start: at("2026-11-30T00:00:00Z"), end: at("2026-12-05T00:00:00Z") },
		];
		expect(chooseEvening(monday, all, [])).toEqual({ skip: "busy" });
	});

	test("a trip over the week skips as travel", () => {
		const trip = [
			{ start: at("2026-11-28T00:00:00Z"), end: at("2026-12-06T00:00:00Z") },
		];
		expect(chooseEvening(monday, [], trip)).toEqual({ skip: "travel" });
	});

	test("a trip over part of the week leaves the other evenings", () => {
		const backWednesdayNoon = [
			{ start: at("2026-11-29T00:00:00Z"), end: at("2026-12-02T12:00:00Z") },
		];
		expect(chooseEvening(monday, [], backWednesdayNoon)).toEqual({
			date: "2026-12-02",
		});
		const backThursday = [
			{ start: at("2026-11-29T00:00:00Z"), end: at("2026-12-03T12:00:00Z") },
		];
		expect(chooseEvening(monday, [], backThursday)).toEqual({
			date: "2026-12-04",
		});
	});
});
