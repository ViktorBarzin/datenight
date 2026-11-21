/**
 * The repeat rule (GLOSSARY.md, "Repeat"): an Idea at the venue of a Past
 * date, or, for classes and experiences, of the same Activity kind as a Past
 * date. Food and drink repeat only by venue, so a new restaurant is always a
 * new date.
 */
import type { IdeaIdentity, PastDateFacts } from "./types";

const DROP_WORDS = new Set(["the", "london", "ltd", "limited"]);

/** Lower case, no accents, no punctuation, no "the" or "london". */
export function normalizeName(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.split(" ")
		.filter((word) => word !== "" && !DROP_WORDS.has(word))
		.join(" ");
}

/**
 * The same place, or another branch of it: one normalised name is the other,
 * or starts it on a word boundary ("Dishoom" and "Dishoom Shoreditch").
 */
export function sameVenue(a: string, b: string): boolean {
	const x = normalizeName(a);
	const y = normalizeName(b);
	if (x === "" || y === "") return false;
	if (x === y) return true;
	const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
	return longer.startsWith(`${shorter} `);
}

/** Words that say how an activity is sold, not what it is. */
const GENERIC_WORDS = new Set([
	"class",
	"workshop",
	"experience",
	"session",
	"lesson",
	"course",
	"making",
	"evening",
	"night",
	"for",
	"two",
	"couples",
	"couple",
	"and",
	"a",
	"an",
	"of",
	"with",
]);

function coreWords(kind: string): Set<string> {
	return new Set(
		normalizeName(kind)
			.split(" ")
			.map((word) =>
				word.length > 3 && word.endsWith("es") && !word.endsWith("ses")
					? word.slice(0, -2)
					: word,
			)
			.map((word) =>
				word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
					? word.slice(0, -1)
					: word,
			)
			.filter((word) => word !== "" && !GENERIC_WORDS.has(word)),
	);
}

/**
 * The same Activity kind: at least half of the words that name the activity
 * are shared ("pottery wheel class" and "pottery class", not "cocktail
 * making" and "chocolate making").
 */
export function sameActivityKind(a: string, b: string): boolean {
	const x = coreWords(a);
	const y = coreWords(b);
	if (x.size === 0 || y.size === 0) return false;
	let shared = 0;
	for (const word of x) if (y.has(word)) shared++;
	const union = x.size + y.size - shared;
	return shared / union >= 0.5;
}

export function isRepeat(
	idea: IdeaIdentity,
	pastDates: readonly PastDateFacts[],
): boolean {
	return pastDates.some(
		(done) =>
			sameVenue(idea.venue, done.venue) ||
			(idea.category !== "food" &&
				done.category !== "food" &&
				sameActivityKind(idea.activityKind, done.activityKind)),
	);
}
