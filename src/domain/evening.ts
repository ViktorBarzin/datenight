/**
 * The Date evening (GLOSSARY.md): Tuesday or Wednesday from 19:00, else
 * Monday or Friday, never Thursday. The Shortlist looks at the next week, so
 * popular shows and classes still have seats.
 */

export const DATE_START = "19:00";
/** The part of the evening that must be free. */
const EVENING_FROM = "18:30";
const EVENING_TO = "23:00";
/** Offsets from Monday, in the order they are tried. */
const EVENING_ORDER = [1, 2, 0, 4];

export interface Interval {
	start: Date;
	end: Date;
}

export type EveningChoice = { date: string } | { skip: "busy" | "travel" };

const londonParts = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/London",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
	weekday: "short",
});

function partsOf(instant: Date): Record<string, string> {
	return Object.fromEntries(
		londonParts.formatToParts(instant).map((p) => [p.type, p.value]),
	);
}

/** The day in London, YYYY-MM-DD. */
export function londonDate(instant: Date): string {
	const p = partsOf(instant);
	return `${p.year}-${p.month}-${p.day}`;
}

/** The instant a London wall-clock time happens on a day. */
export function londonTime(date: string, time: string): Date {
	const guess = new Date(`${date}T${time}:00Z`);
	const p = partsOf(guess);
	const shown = Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour),
		Number(p.minute),
	);
	return new Date(guess.getTime() - (shown - guess.getTime()));
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** 0 for Monday to 6 for Sunday. */
function weekdayIndex(date: string): number {
	return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week that holds a day. */
export function mondayOf(date: string): string {
	return addDays(date, -weekdayIndex(date));
}

/**
 * The Monday of the week the Shortlist plans for: the week after the
 * current London week, where Saturday and Sunday already count as the week
 * that starts on the coming Monday.
 */
export function nextWeekMonday(now: Date): string {
	return addDays(mondayOf(addDays(londonDate(now), 2)), 7);
}

function overlaps(a: Interval, b: Interval): boolean {
	return a.start < b.end && b.start < a.end;
}

export function chooseEvening(
	monday: string,
	busy: readonly Interval[],
	trips: readonly Interval[],
): EveningChoice {
	let travelBlocked = false;
	for (const offset of EVENING_ORDER) {
		const date = addDays(monday, offset);
		const evening = {
			start: londonTime(date, EVENING_FROM),
			end: londonTime(date, EVENING_TO),
		};
		if (trips.some((trip) => overlaps(trip, evening))) {
			travelBlocked = true;
			continue;
		}
		if (busy.some((event) => overlaps(event, evening))) continue;
		return { date };
	}
	return { skip: travelBlocked ? "travel" : "busy" };
}
