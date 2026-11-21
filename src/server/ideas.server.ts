/**
 * Ideas: adding them from a Scout run or as Saved ideas, and ranking the
 * open ones. A new Idea that is a Repeat is stored with status "repeat", so
 * the next Scout run recognises it and it is never offered.
 */

import { getLogger } from "@viktorbarzin/log";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { addDays, londonDate } from "#/domain/evening";
import { scoreIdea, tasteWeights } from "#/domain/rank";
import { isRepeat, normalizeName } from "#/domain/repeat";
import {
	type Category,
	type IdeaFacts,
	isCategory,
	type PastDateFacts,
} from "#/domain/types";
import { dates, type IdeaRow, ideas } from "./db/schema.server";
import type { Db, Tx } from "./db.server";
import type { Deps } from "./deps.server";
import type { ScoutIdea } from "./integrations/scout.server";

const log = getLogger("datenight.ideas");

export interface NewIdea {
	title: string;
	venue: string;
	address?: string;
	area?: string;
	postcode?: string;
	category: Category;
	activityKind: string;
	priceGbp: number | null;
	url?: string;
	bookingUrl?: string;
	description?: string;
	why?: string;
	endsOn?: string | null;
}

export function fromScout(i: ScoutIdea): NewIdea {
	return {
		title: i.title,
		venue: i.venue,
		address: i.address,
		area: i.area,
		postcode: i.postcode,
		category: i.category,
		activityKind: i.activity_kind,
		priceGbp: i.price_gbp_for_two,
		url: i.url,
		bookingUrl: i.booking_url,
		description: i.description,
		why: i.why,
		endsOn: i.ends_on,
	};
}

export function dedupeKey(venue: string, title: string): string {
	return `${normalizeName(venue)}|${normalizeName(title)}`;
}

/** Past dates that count for the repeat rule: booked or done. */
export async function pastDateFacts(db: Db | Tx): Promise<PastDateFacts[]> {
	const rows = await db
		.select()
		.from(dates)
		.where(inArray(dates.status, ["booked", "done"]));
	return rows.map((r) => ({
		venue: r.venue,
		activityKind: r.activityKind,
		category: isCategory(r.category) ? r.category : "food",
		on: r.on,
		rating: r.rating,
	}));
}

export interface AddResult {
	added: number;
	repeats: number;
	duplicates: number;
	ids: string[];
}

export async function addIdeas(
	db: Db,
	deps: Deps,
	list: readonly NewIdea[],
	source: "scout" | "saved",
): Promise<AddResult> {
	const past = await pastDateFacts(db);
	let positions = new Map<string, { lat: number; lon: number }>();
	try {
		positions = await deps.geocode(list.map((i) => i.postcode ?? ""));
	} catch (err) {
		log.warn("geocoding failed; ideas stored without a position", {
			error: String(err),
		});
	}
	const result: AddResult = { added: 0, repeats: 0, duplicates: 0, ids: [] };
	for (const idea of list) {
		const repeat = isRepeat(idea, past);
		const pos = positions.get((idea.postcode ?? "").trim().toUpperCase());
		const [row] = await db
			.insert(ideas)
			.values({
				title: idea.title,
				venue: idea.venue,
				address: idea.address ?? "",
				area: idea.area ?? "",
				postcode: idea.postcode ?? "",
				lat: pos?.lat ?? null,
				lon: pos?.lon ?? null,
				category: idea.category,
				activityKind: idea.activityKind,
				priceGbp: idea.priceGbp,
				url: idea.url ?? "",
				bookingUrl: idea.bookingUrl ?? "",
				description: idea.description ?? "",
				why: idea.why ?? "",
				source,
				status: repeat ? "repeat" : "open",
				endsOn: idea.endsOn ?? null,
				dedupeKey: dedupeKey(idea.venue, idea.title),
			})
			.onConflictDoNothing({ target: ideas.dedupeKey })
			.returning({ id: ideas.id });
		if (!row) {
			result.duplicates++;
			// A Saved idea the scout already found still gets the Saved boost.
			if (source === "saved") {
				const [existing] = await db
					.update(ideas)
					.set({ source: "saved" })
					.where(eq(ideas.dedupeKey, dedupeKey(idea.venue, idea.title)))
					.returning({ id: ideas.id });
				if (existing) result.ids.push(existing.id);
			}
			continue;
		}
		result.ids.push(row.id);
		if (repeat) result.repeats++;
		else result.added++;
	}
	return result;
}

export function ideaFacts(row: IdeaRow): IdeaFacts {
	return {
		id: row.id,
		title: row.title,
		venue: row.venue,
		activityKind: row.activityKind,
		category: isCategory(row.category) ? row.category : "food",
		priceGbp: row.priceGbp,
		lat: row.lat,
		lon: row.lon,
		saved: row.source === "saved",
		liked: row.reaction === "like",
		rejections: row.rejections,
		text: `${row.description} ${row.why}`,
	};
}

/**
 * Open Ideas that can still happen on a day, best first. Ideas that turned
 * into Repeats since they were found (a Past date confirmed later) are
 * marked and left out.
 */
export async function rankedIdeas(
	db: Db,
	deps: Deps,
	onDay: string,
	opts: { unswipedOnly?: boolean } = {},
): Promise<IdeaFacts[]> {
	const [open, past, rated, swiped] = await Promise.all([
		db.select().from(ideas).where(eq(ideas.status, "open")),
		pastDateFacts(db),
		db
			.select({ category: dates.category, rating: dates.rating })
			.from(dates)
			.where(and(eq(dates.status, "done"), isNotNull(dates.rating))),
		db
			.select({ category: ideas.category, reaction: ideas.reaction })
			.from(ideas)
			.where(isNotNull(ideas.reaction)),
	]);
	let hints: string[] = [];
	try {
		hints = await deps.hints();
	} catch (err) {
		log.warn("Noticing File unreadable; ranking without hints", {
			error: String(err),
		});
	}
	const lastByCategory: Partial<Record<Category, string>> = {};
	for (const p of past) {
		const last = lastByCategory[p.category];
		if (last === undefined || p.on > last) lastByCategory[p.category] = p.on;
	}
	const ctx = {
		weights: tasteWeights(
			rated.flatMap((r) =>
				isCategory(r.category) && r.rating !== null
					? [{ category: r.category, rating: r.rating }]
					: [],
			),
			swiped.flatMap((r) =>
				isCategory(r.category)
					? [{ category: r.category, liked: r.reaction === "like" }]
					: [],
			),
		),
		lastByCategory,
		today: londonDate(deps.now()),
		home: deps.settings.home,
		hints,
	};
	const nowRepeat: string[] = [];
	const usable: IdeaFacts[] = [];
	for (const row of open) {
		if (row.endsOn !== null && row.endsOn < onDay) continue;
		if (opts.unswipedOnly && row.reaction !== null) continue;
		const facts = ideaFacts(row);
		if (isRepeat(facts, past)) nowRepeat.push(row.id);
		else usable.push(facts);
	}
	if (nowRepeat.length > 0)
		await db
			.update(ideas)
			.set({ status: "repeat" })
			.where(inArray(ideas.id, nowRepeat));
	return usable
		.map((facts) => ({ facts, score: scoreIdea(facts, ctx) }))
		.sort((a, b) => b.score - a.score)
		.map((s) => s.facts);
}

export async function ideasByIds(
	db: Db | Tx,
	ids: readonly string[],
): Promise<IdeaRow[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select()
		.from(ideas)
		.where(inArray(ideas.id, [...ids]));
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.flatMap((id) => {
		const row = byId.get(id);
		return row ? [row] : [];
	});
}

export async function listIdeas(
	db: Db,
	status: string,
	limit: number,
): Promise<IdeaRow[]> {
	const where =
		status === "liked"
			? and(eq(ideas.status, "open"), eq(ideas.reaction, "like"))
			: eq(ideas.status, status);
	return db
		.select()
		.from(ideas)
		.where(where)
		.orderBy(desc(ideas.reactedAt), desc(ideas.createdAt))
		.limit(limit);
}

export async function setIdeaStatus(
	db: Db,
	id: string,
	status: "open" | "dismissed",
): Promise<boolean> {
	// "Not for us" is a pass; bringing it back clears the swipe.
	const rows = await db
		.update(ideas)
		.set(
			status === "dismissed"
				? { status, reaction: "pass", reactedAt: new Date() }
				: { status, reaction: null, reactedAt: null },
		)
		.where(and(eq(ideas.id, id), inArray(ideas.status, ["open", "dismissed"])))
		.returning({ id: ideas.id });
	return rows.length > 0;
}

/** How many open Ideas the next few weeks can draw from. */
export async function openIdeaCount(db: Db, deps: Deps): Promise<number> {
	const today = londonDate(deps.now());
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(ideas)
		.where(
			and(
				eq(ideas.status, "open"),
				sql`(${ideas.endsOn} is null or ${ideas.endsOn} >= ${addDays(today, 7)})`,
			),
		);
	return row?.n ?? 0;
}
