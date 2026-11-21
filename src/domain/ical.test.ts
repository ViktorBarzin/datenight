import { describe, expect, test } from "bun:test";

import { buildEvent, parseEvents, parseTodos } from "./ical";

const feed = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"BEGIN:VTIMEZONE",
	"TZID:Europe/London",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"UID:a@x",
	"SUMMARY:Dinner at BAB N SUUL",
	"DTSTART;TZID=Europe/London:20261028T190000",
	"DTEND;TZID=Europe/London:20261028T203000",
	"LOCATION:1 Gerrard Place\\, London",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:b@x",
	"SUMMARY:Flight LTN to SZX with a very long title that the server folds over",
	"  two lines",
	"DTSTART:20261102T061500Z",
	"DTEND:20261102T190000Z",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:c@x",
	"SUMMARY:Hotel",
	"DTSTART;VALUE=DATE:20261103",
	"DTEND;VALUE=DATE:20261110",
	"END:VEVENT",
	"END:VCALENDAR",
].join("\r\n");

describe("parseEvents", () => {
	const events = parseEvents(feed);

	test("reads London wall-clock times", () => {
		expect(events[0]).toMatchObject({
			uid: "a@x",
			summary: "Dinner at BAB N SUUL",
			location: "1 Gerrard Place, London",
			allDay: false,
		});
		expect(events[0]?.start.toISOString()).toBe("2026-10-28T19:00:00.000Z");
		expect(events[0]?.end.toISOString()).toBe("2026-10-28T20:30:00.000Z");
	});

	test("unfolds long lines and reads UTC times", () => {
		expect(events[1]?.summary).toBe(
			"Flight LTN to SZX with a very long title that the server folds over two lines",
		);
		expect(events[1]?.start.toISOString()).toBe("2026-11-02T06:15:00.000Z");
	});

	test("an all-day event covers whole London days", () => {
		expect(events[2]?.allDay).toBe(true);
		expect(events[2]?.start.toISOString()).toBe("2026-11-03T00:00:00.000Z");
		expect(events[2]?.end.toISOString()).toBe("2026-11-10T00:00:00.000Z");
	});

	test("an event with no end lasts an hour, or a day when all-day", () => {
		const [timed, day] = parseEvents(
			"BEGIN:VEVENT\nUID:d\nDTSTART:20261201T190000Z\nEND:VEVENT\nBEGIN:VEVENT\nUID:e\nDTSTART;VALUE=DATE:20261202\nEND:VEVENT",
		);
		expect(timed?.end.toISOString()).toBe("2026-12-01T20:00:00.000Z");
		expect(day?.end.toISOString()).toBe("2026-12-03T00:00:00.000Z");
	});
});

describe("parseTodos", () => {
	test("reads each summary and description", () => {
		const todos = parseTodos(
			"BEGIN:VTODO\nUID:t1\nSUMMARY:2026-07-11 — wants to try flamenco\nDESCRIPTION:said at dinner\nEND:VTODO",
		);
		expect(todos).toEqual([
			{
				uid: "t1",
				summary: "2026-07-11 — wants to try flamenco",
				description: "said at dinner",
			},
		]);
	});
});

describe("buildEvent", () => {
	const text = buildEvent({
		uid: "hold-1@datenight",
		start: new Date("2026-12-01T19:00:00Z"),
		end: new Date("2026-12-01T22:30:00Z"),
		summary: "Surprise date",
		description: "Dress code: smart casual, Area: Peckham",
		location: "Peckham",
		organizer: { name: "Owner Name", email: "owner@example.com" },
		attendees: [{ name: "Partner Name", email: "partner@example.com" }],
		now: new Date("2026-11-24T09:00:00Z"),
	});

	test("is a calendar with one event, CRLF line ends", () => {
		expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
		expect(text).toContain("\r\nBEGIN:VEVENT\r\n");
		expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
	});

	test("escapes commas and carries the attendee for an invitation", () => {
		const unfolded = text.replace(/\r\n /g, "");
		expect(unfolded).toContain(
			"DESCRIPTION:Dress code: smart casual\\, Area: Peckham",
		);
		expect(unfolded).toContain("DTSTART:20261201T190000Z");
		expect(unfolded).toContain(
			"ORGANIZER;CN=Owner Name:mailto:owner@example.com",
		);
		expect(unfolded).toContain(
			"ATTENDEE;CN=Partner Name;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:partner@example.com",
		);
	});

	test("round-trips through the parser", () => {
		const [event] = parseEvents(text);
		expect(event?.summary).toBe("Surprise date");
		expect(event?.start.toISOString()).toBe("2026-12-01T19:00:00.000Z");
	});

	test("folds lines longer than 75 octets", () => {
		const long = buildEvent({
			uid: "u",
			start: new Date("2026-12-01T19:00:00Z"),
			end: new Date("2026-12-01T20:00:00Z"),
			summary: "x".repeat(200),
			now: new Date("2026-11-24T09:00:00Z"),
		});
		for (const line of long.split("\r\n"))
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		expect(parseEvents(long)[0]?.summary).toBe("x".repeat(200));
	});
});
