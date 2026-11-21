/**
 * Possible Past dates from what already exists: evening events in the
 * Owner's calendar, spending on eating out and entertainment, and days with
 * many evening photos. The Owner confirms each one, so the rules here only
 * decide what is worth asking about.
 */
import { addDays, type Interval, londonDate, londonTime } from "./evening";

export interface EventEvidence {
	on: string;
	/** London hour the event starts, 0 to 23. */
	startHour: number;
	summary: string;
	location: string;
}

export interface SpendEvidence {
	on: string;
	payee: string;
	notes: string;
	/** Negative for money out. */
	amountPence: number;
}

export interface PhotoDay {
	on: string;
	count: number;
	places: string[];
}

export interface Evidence {
	source: "calendar" | "bank" | "photos";
	text: string;
}

export interface HistoryCandidate {
	on: string;
	venueGuess: string;
	evidence: Evidence[];
}

const EVENING_FROM_HOUR = 17;
const MIN_SPEND_PENCE = 2000;
const MIN_PHOTOS_ALONE = 8;
const NOT_A_PLACE =
	/\b(youtube|spotify|netflix|google|apple|amazon|prime|disney|atm|cash|perks|steam|playstation|xbox|patreon|subscription|deliveroo|uber ?eats|just ?eat)\b/i;

export function venueFromSummary(summary: string): string {
	const s = summary.trim();
	const at = /(?:\bat|@)\s+(.+)$/i.exec(s);
	if (at?.[1]) return at[1].trim();
	const dash = /^(.+?)\s+[-–—:]\s+/.exec(s);
	if (dash?.[1]) return dash[1].trim();
	return s;
}

export function isSpendCandidate(
	spend: Pick<SpendEvidence, "payee" | "amountPence">,
): boolean {
	return (
		spend.amountPence <= -MIN_SPEND_PENCE && !NOT_A_PLACE.test(spend.payee)
	);
}

function pounds(pence: number): string {
	return `£${(Math.abs(pence) / 100).toFixed(2)}`;
}

export function candidatesFrom(input: {
	events: readonly EventEvidence[];
	spends: readonly SpendEvidence[];
	photoDays: readonly PhotoDay[];
}): HistoryCandidate[] {
	const byDay = new Map<
		string,
		{ evidence: Evidence[]; venue: string | null; anchored: boolean }
	>();
	const day = (on: string) => {
		let entry = byDay.get(on);
		if (!entry) {
			entry = { evidence: [], venue: null, anchored: false };
			byDay.set(on, entry);
		}
		return entry;
	};

	for (const e of input.events) {
		if (e.startHour < EVENING_FROM_HOUR) continue;
		const entry = day(e.on);
		entry.evidence.push({
			source: "calendar",
			text: e.location ? `${e.summary} (${e.location})` : e.summary,
		});
		entry.venue ??= venueFromSummary(e.summary);
		entry.anchored = true;
	}
	for (const s of input.spends) {
		if (!isSpendCandidate(s)) continue;
		const entry = day(s.on);
		const note = s.notes && s.notes !== s.payee ? `, "${s.notes}"` : "";
		entry.evidence.push({
			source: "bank",
			text: `${s.payee} ${pounds(s.amountPence)}${note}`,
		});
		entry.venue ??= s.payee;
		entry.anchored = true;
	}
	for (const p of input.photoDays) {
		const entry = byDay.get(p.on);
		if (!entry && p.count < MIN_PHOTOS_ALONE) continue;
		const target = entry ?? day(p.on);
		const where = p.places.length > 0 ? ` in ${p.places.join(", ")}` : "";
		target.evidence.push({
			source: "photos",
			text: `${p.count} evening photos${where}`,
		});
		target.anchored = true;
	}

	return [...byDay.entries()]
		.filter(([, entry]) => entry.anchored)
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([on, entry]) => ({
			on,
			venueGuess: entry.venue ?? "",
			evidence: entry.evidence,
		}));
}

/**
 * London days whose evening (18:00 to 23:00) a trip segment touches. Those
 * evenings were not London dates, so their evidence is left out.
 */
export function awayDays(trips: readonly Interval[]): Set<string> {
	const out = new Set<string>();
	for (const trip of trips) {
		const last = londonDate(trip.end);
		for (let day = londonDate(trip.start); day <= last; day = addDays(day, 1)) {
			const from = londonTime(day, "18:00");
			const to = londonTime(day, "23:00");
			if (trip.start < to && from < trip.end) out.add(day);
		}
	}
	return out;
}
