/**
 * The Owner's Nextcloud calendars over CalDAV: busy evenings and history
 * from the Date calendar, hints from the Noticing File, and the two events
 * each Date adds (the Owner's own, and the Surprise hold Nextcloud mails to
 * the Partner because she is an attendee).
 */
import {
	type CalendarEvent,
	parseEvents,
	parseTodos,
	type Todo,
} from "#/domain/ical";
import type { DateNightSettings } from "../env.server";

type CalDav = NonNullable<DateNightSettings["caldav"]>;

const TIMEOUT_MS = 60_000;
/** Long ranges time out on the server, so history is read in slices. */
const SLICE_DAYS = 90;

function auth(cfg: CalDav): string {
	return `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`;
}

function calendarUrl(cfg: CalDav, calendar: string): string {
	return `${cfg.baseUrl}/calendars/${encodeURIComponent(cfg.user)}/${encodeURIComponent(calendar)}/`;
}

function stamp(at: Date): string {
	return at
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#13;/g, "\r")
		.replace(/&#10;/g, "\n")
		.replace(/&amp;/g, "&");
}

/** The calendar-data bodies in a multistatus answer. */
export function calendarData(xml: string): string[] {
	const out: string[] = [];
	const re =
		/<(?:[a-zA-Z0-9]+:)?calendar-data[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?calendar-data>/g;
	for (let m = re.exec(xml); m; m = re.exec(xml))
		out.push(unescapeXml(m[1] ?? ""));
	return out;
}

async function report(
	cfg: CalDav,
	calendar: string,
	body: string,
): Promise<string> {
	const res = await fetch(calendarUrl(cfg, calendar), {
		method: "REPORT",
		headers: {
			Authorization: auth(cfg),
			Depth: "1",
			"Content-Type": "application/xml; charset=utf-8",
		},
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (res.status !== 207)
		throw new Error(`CalDAV REPORT ${calendar} answered ${res.status}`);
	return res.text();
}

async function eventsIn(
	cfg: CalDav,
	calendar: string,
	from: Date,
	to: Date,
): Promise<CalendarEvent[]> {
	const range = `start="${stamp(from)}" end="${stamp(to)}"`;
	const xml = await report(
		cfg,
		calendar,
		`<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data><c:expand ${range}/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${range}/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`,
	);
	return calendarData(xml).flatMap(parseEvents);
}

/** Events of the Date calendar between two instants, recurring ones expanded. */
export async function calendarEvents(
	cfg: CalDav,
	from: Date,
	to: Date,
): Promise<CalendarEvent[]> {
	const out: CalendarEvent[] = [];
	for (let start = from; start < to; ) {
		const end = new Date(
			Math.min(to.getTime(), start.getTime() + SLICE_DAYS * 86_400_000),
		);
		out.push(...(await eventsIn(cfg, cfg.calendar, start, end)));
		start = end;
	}
	const seen = new Set<string>();
	return out.filter((e) => {
		const key = `${e.uid}|${e.start.toISOString()}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** The Noticing File entries, or none when it is not set up. */
export async function noticingTodos(cfg: CalDav): Promise<Todo[]> {
	if (!cfg.noticing) return [];
	const xml = await report(
		cfg,
		cfg.noticing,
		`<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>`,
	);
	return calendarData(xml).flatMap(parseTodos);
}

/** Create an event in the Date calendar; refuses to overwrite one with the same UID. */
export async function putEvent(
	cfg: CalDav,
	uid: string,
	ics: string,
): Promise<void> {
	const res = await fetch(
		`${calendarUrl(cfg, cfg.calendar)}${encodeURIComponent(uid)}.ics`,
		{
			method: "PUT",
			headers: {
				Authorization: auth(cfg),
				"Content-Type": "text/calendar; charset=utf-8",
				"If-None-Match": "*",
			},
			body: ics,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);
	if (res.status !== 201 && res.status !== 204)
		throw new Error(`CalDAV PUT answered ${res.status}`);
}

/** Remove an event this app made, for a cancelled Date. A missing event is fine. */
export async function deleteEvent(cfg: CalDav, uid: string): Promise<void> {
	const res = await fetch(
		`${calendarUrl(cfg, cfg.calendar)}${encodeURIComponent(uid)}.ics`,
		{
			method: "DELETE",
			headers: { Authorization: auth(cfg) },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	);
	if (res.status !== 204 && res.status !== 200 && res.status !== 404)
		throw new Error(`CalDAV DELETE answered ${res.status}`);
}
