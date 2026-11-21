/**
 * The words of GLOSSARY.md as types. Pure data: no database, no I/O, so the
 * rules in this folder run the same in tests, on the server and in the page.
 */

export const CATEGORIES = ["shows", "food", "classes", "active"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
	shows: "Shows and immersive",
	food: "Food and drink",
	classes: "Hands-on classes",
	active: "Active and outdoors",
};

export function isCategory(value: string): value is Category {
	return (CATEGORIES as readonly string[]).includes(value);
}

/** An Idea costs more than this, for the couple, to be a Splurge. */
export const SPLURGE_OVER_GBP = 80;

/** The facts the repeat rule needs about an Idea. */
export interface IdeaIdentity {
	venue: string;
	activityKind: string;
	category: Category;
}

/** The facts the score needs about an Idea. */
export interface IdeaFacts extends IdeaIdentity {
	id: string;
	title: string;
	/** For the couple, in whole pounds; null when the scout found no price. */
	priceGbp: number | null;
	lat: number | null;
	lon: number | null;
	/** A Saved idea: the Owner sent it in. */
	saved: boolean;
	/** The Owner swiped right on it. */
	liked: boolean;
	/** How many Shortlists the Owner turned down with this Idea on them. */
	rejections: number;
	/** Free text the Noticing File hints are matched against. */
	text: string;
}

/** The facts the rules need about a Past date. */
export interface PastDateFacts extends IdeaIdentity {
	/** The day, YYYY-MM-DD. */
	on: string;
	rating: number | null;
}

export interface LatLon {
	lat: number;
	lon: number;
}

export function isSplurge(priceGbp: number | null): boolean {
	return priceGbp !== null && priceGbp > SPLURGE_OVER_GBP;
}
