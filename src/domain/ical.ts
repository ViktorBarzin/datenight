/**
 * The small part of iCalendar (RFC 5545) the app reads and writes: VEVENTs
 * from a CalDAV calendar or the TripIt feed, VTODOs from the Noticing File,
 * and one VEVENT per Date for the Owner's calendar.
 */

export interface CalendarEvent {
	uid: string;
	summary: string;
	location: string;
	description: string;
	start: Date;
	end: Date;
	allDay: boolean;
}

export interface Todo {
	uid: string;
	summary: string;
	description: string;
}

interface Property {
	name: string;
	params: Record<string, string>;
	value: string;
}

function unfold(text: string): string[] {
	return text
		.replace(/\r\n|\r/g, "\n")
		.replace(/\n[ \t]/g, "")
		.split("\n");
}

function parseLine(line: string): Property | null {
	const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
	if (colon < 0) return null;
	const [name = "", ...rawParams] = line.slice(0, colon).split(";");
	const params: Record<string, string> = {};
	for (const raw of rawParams) {
		const eq = raw.indexOf("=");
		if (eq > 0)
			params[raw.slice(0, eq).toUpperCase()] = raw
				.slice(eq + 1)
				.replace(/^"|"$/g, "");
	}
	return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
	return value.replace(/\\([\\;,nN])/g, (_, ch: string) =>
		ch === "n" || ch === "N" ? "\n" : ch,
	);
}

function components(text: string, kind: string): Map<string, Property>[] {
	const out: Map<string, Property>[] = [];
	let current: Map<string, Property> | null = null;
	let depth = 0;
	for (const line of unfold(text)) {
		if (line === `BEGIN:${kind}`) {
			current = new Map();
			depth = 0;
			continue;
		}
		if (!current) continue;
		if (line === `END:${kind}` && depth === 0) {
			out.push(current);
			current = null;
			continue;
		}
		if (line.startsWith("BEGIN:")) depth++;
		else if (line.startsWith("END:")) depth--;
		else if (depth === 0) {
			const prop = parseLine(line);
			if (prop && !current.has(prop.name)) current.set(prop.name, prop);
		}
	}
	return out;
}

/** The instant a wall-clock time happens in an IANA time zone. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
	const guess = new Date(`${date}T${time}Z`);
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-GB", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(guess)
			.map((p) => [p.type, p.value]),
	);
	const shown = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second),
	);
	return new Date(guess.getTime() - (shown - guess.getTime()));
}

function parseTime(prop: Property): { at: Date; allDay: boolean } | null {
	const v = prop.value.trim();
	const day = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
	if (day || prop.params.VALUE === "DATE") {
		const m = day ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
		if (!m) return null;
		return {
			at: zonedTime(`${m[1]}-${m[2]}-${m[3]}`, "00:00:00", "Europe/London"),
			allDay: true,
		};
	}
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
	if (!m) return null;
	const date = `${m[1]}-${m[2]}-${m[3]}`;
	const time = `${m[4]}:${m[5]}:${m[6]}`;
	if (m[7] === "Z") return { at: new Date(`${date}T${time}Z`), allDay: false };
	let zone = prop.params.TZID ?? "Europe/London";
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: zone });
	} catch {
		zone = "Europe/London";
	}
	return { at: zonedTime(date, time, zone), allDay: false };
}

export function parseEvents(text: string): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	for (const props of components(text, "VEVENT")) {
		const startProp = props.get("DTSTART");
		const start = startProp ? parseTime(startProp) : null;
		if (!start) continue;
		const endProp = props.get("DTEND");
		const parsedEnd = endProp ? parseTime(endProp) : null;
		const end = parsedEnd
			? parsedEnd.at
			: new Date(start.at.getTime() + (start.allDay ? 86_400_000 : 3_600_000));
		events.push({
			uid: props.get("UID")?.value ?? "",
			summary: unescapeText(props.get("SUMMARY")?.value ?? ""),
			location: unescapeText(props.get("LOCATION")?.value ?? ""),
			description: unescapeText(props.get("DESCRIPTION")?.value ?? ""),
			start: start.at,
			end,
			allDay: start.allDay,
		});
	}
	return events;
}

export function parseTodos(text: string): Todo[] {
	return components(text, "VTODO").map((props) => ({
		uid: props.get("UID")?.value ?? "",
		summary: unescapeText(props.get("SUMMARY")?.value ?? ""),
		description: unescapeText(props.get("DESCRIPTION")?.value ?? ""),
	}));
}

function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r?\n/g, "\\n");
}

function utcStamp(at: Date): string {
	return at
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

/** Fold a content line at 75 octets, never inside a UTF-8 character. */
function fold(line: string): string {
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = "";
	let size = 0;
	for (const ch of line) {
		const n = encoder.encode(ch).length;
		const limit = parts.length === 0 ? 75 : 74;
		if (size + n > limit) {
			parts.push(current);
			current = "";
			size = 0;
		}
		current += ch;
		size += n;
	}
	parts.push(current);
	return parts.join("\r\n ");
}

export interface Person {
	name: string;
	email: string;
}

function cn(name: string): string {
	return /[;:,"]/.test(name) ? `"${name.replace(/"/g, "")}"` : name;
}

export function buildEvent(e: {
	uid: string;
	start: Date;
	end: Date;
	summary: string;
	description?: string;
	location?: string;
	organizer?: Person;
	attendees?: readonly Person[];
	now: Date;
}): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//viktorbarzin//datenight//EN",
		"CALSCALE:GREGORIAN",
		"BEGIN:VEVENT",
		`UID:${e.uid}`,
		`DTSTAMP:${utcStamp(e.now)}`,
		`DTSTART:${utcStamp(e.start)}`,
		`DTEND:${utcStamp(e.end)}`,
		`SUMMARY:${escapeText(e.summary)}`,
	];
	if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
	if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
	if (e.organizer)
		lines.push(
			`ORGANIZER;CN=${cn(e.organizer.name)}:mailto:${e.organizer.email}`,
		);
	for (const a of e.attendees ?? []) {
		lines.push(
			`ATTENDEE;CN=${cn(a.name)};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
		);
	}
	lines.push("TRANSP:OPAQUE", "END:VEVENT", "END:VCALENDAR");
	return `${lines.map(fold).join("\r\n")}\r\n`;
}
