/**
 * How Ideas are ranked and how the Shortlist is picked. The taste starts with
 * the Owner's three favoured Categories and moves with each Rating.
 */
import { type Category, type IdeaFacts, isSplurge, type LatLon } from "./types";

const START_WEIGHTS: Record<Category, number> = {
	shows: 1,
	food: 1,
	classes: 1,
	active: 0.3,
};
const RATING_STEP = 0.15;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 2;

/** A swipe moves a category a third as far as a rating one step from neutral. */
const SWIPE_STEP = RATING_STEP / 3;

export function tasteWeights(
	ratings: readonly { category: Category; rating: number }[],
	swipes: readonly { category: Category; liked: boolean }[] = [],
): Record<Category, number> {
	const weights = { ...START_WEIGHTS };
	for (const { category, liked } of swipes) {
		weights[category] = Math.min(
			MAX_WEIGHT,
			Math.max(
				MIN_WEIGHT,
				weights[category] + (liked ? SWIPE_STEP : -SWIPE_STEP),
			),
		);
	}
	for (const { category, rating } of ratings) {
		weights[category] = Math.min(
			MAX_WEIGHT,
			Math.max(MIN_WEIGHT, weights[category] + (rating - 3) * RATING_STEP),
		);
	}
	return weights;
}

export function distanceKm(a: LatLon, b: LatLon): number {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface RankContext {
	weights: Record<Category, number>;
	/** The day of the last Past date in each Category, YYYY-MM-DD. */
	lastByCategory: Partial<Record<Category, string>>;
	today: string;
	home: LatLon | null;
	/** Noticing File entries, as written. */
	hints: readonly string[];
}

const HINT_STOP = new Set([
	"the",
	"and",
	"she",
	"her",
	"with",
	"that",
	"this",
	"would",
	"want",
	"wants",
	"love",
	"loves",
	"like",
	"likes",
	"said",
	"some",
	"time",
	"about",
	"from",
	"have",
	"there",
	"they",
	"were",
	"what",
	"when",
	"into",
	"going",
	"night",
	"london",
	"date",
	"really",
	"maybe",
	"again",
	"something",
]);

function words(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z]+/)
			.filter((word) => word.length >= 4 && !HINT_STOP.has(word)),
	);
}

function daysBetween(from: string, to: string): number {
	return (
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
		86_400_000
	);
}

export function scoreIdea(idea: IdeaFacts, ctx: RankContext): number {
	let score = 50 * ctx.weights[idea.category];

	const last = ctx.lastByCategory[idea.category];
	score +=
		last === undefined
			? 20
			: Math.min(20, (Math.max(0, daysBetween(last, ctx.today)) / 60) * 20);

	if (idea.priceGbp === null) score += 4;
	else if (!isSplurge(idea.priceGbp)) score += 10;

	if (ctx.home && idea.lat !== null && idea.lon !== null) {
		const km = distanceKm(ctx.home, { lat: idea.lat, lon: idea.lon });
		score += km <= 3 ? 10 : km <= 6 ? 6 : km <= 10 ? 2 : -5;
	} else {
		score += 3;
	}

	if (idea.saved) score += 15;
	score -= 8 * idea.rejections;

	if (ctx.hints.length > 0) {
		const ideaWords = words(
			`${idea.title} ${idea.venue} ${idea.activityKind} ${idea.text}`,
		);
		if (
			ctx.hints.some((hint) =>
				[...words(hint)].some((word) => ideaWords.has(word)),
			)
		)
			score += 10;
	}
	return score;
}

export const SHORTLIST_SIZE = 3;

/**
 * The Shortlist from ideas already in rank order: liked Ideas first, then one
 * per Category while it can, then the next best. When a Splurge is allowed this month, the best
 * Splurge takes the last place; otherwise Splurges stay out.
 */
export function pickShortlist(
	ranked: readonly IdeaFacts[],
	opts: { splurgeAllowed: boolean; exclude?: ReadonlySet<string> },
): string[] {
	const open = ranked.filter((i) => !opts.exclude?.has(i.id));
	const regular = open.filter((i) => !isSplurge(i.priceGbp));
	const splurges = opts.splurgeAllowed
		? open.filter((i) => isSplurge(i.priceGbp))
		: [];
	const splurge = splurges.find((i) => i.liked) ?? splurges[0];
	const places = splurge ? SHORTLIST_SIZE - 1 : SHORTLIST_SIZE;

	// Liked ideas first, best first; then one per Category while it can.
	const picked: IdeaFacts[] = regular.filter((i) => i.liked).slice(0, places);
	const seen = new Set<Category>(picked.map((i) => i.category));
	for (const candidate of regular) {
		if (picked.length >= places) break;
		if (picked.includes(candidate) || seen.has(candidate.category)) continue;
		picked.push(candidate);
		seen.add(candidate.category);
	}
	for (const candidate of regular) {
		if (picked.length >= places) break;
		if (!picked.includes(candidate)) picked.push(candidate);
	}
	if (splurge) picked.push(splurge);
	return picked.map((i) => i.id);
}
