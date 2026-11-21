/**
 * The Shortlist for the week after this one: the Date evening, three Ideas,
 * up to two more rounds when none fit, and the Skipped week when the Owner
 * travels or every evening is busy.
 */
import { and, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";

import {
	addDays,
	chooseEvening,
	DATE_START,
	londonTime,
	nextWeekMonday,
} from "#/domain/evening";
import { pickShortlist, SHORTLIST_SIZE } from "#/domain/rank";
import { SPLURGE_OVER_GBP } from "#/domain/types";
import {
	dates,
	type IdeaRow,
	ideas,
	type ShortlistRow,
	shortlists,
} from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { ideasByIds, rankedIdeas } from "./ideas.server";

export const MAX_ROUNDS = 3;

export interface IdeaView {
	id: string;
	title: string;
	venue: string;
	area: string;
	address: string;
	category: string;
	activityKind: string;
	priceGbp: number | null;
	splurge: boolean;
	url: string;
	bookingUrl: string;
	description: string;
	why: string;
	saved: boolean;
	endsOn: string | null;
}

export function ideaView(row: IdeaRow): IdeaView {
	return {
		id: row.id,
		title: row.title,
		venue: row.venue,
		area: row.area,
		address: row.address,
		category: row.category,
		activityKind: row.activityKind,
		priceGbp: row.priceGbp,
		splurge: row.priceGbp !== null && row.priceGbp > SPLURGE_OVER_GBP,
		url: row.url,
		bookingUrl: row.bookingUrl,
		description: row.description,
		why: row.why,
		saved: row.source === "saved",
		endsOn: row.endsOn,
	};
}

export interface WeekView {
	weekStart: string;
	status: "offered" | "booked" | "skipped" | "exhausted";
	skipReason: string | null;
	evening: { date: string; startsAt: string } | null;
	round: number;
	roundsLeft: number;
	ideas: IdeaView[];
	dateId: string | null;
}

async function view(db: Db, row: ShortlistRow): Promise<WeekView> {
	const rows = await ideasByIds(db, row.ideaIds);
	return {
		weekStart: row.weekStart,
		status: row.status as WeekView["status"],
		skipReason: row.skipReason,
		evening: row.eveningDate
			? {
					date: row.eveningDate,
					startsAt: londonTime(row.eveningDate, DATE_START).toISOString(),
				}
			: null,
		round: row.round,
		roundsLeft: Math.max(0, MAX_ROUNDS - 1 - row.round),
		ideas: rows.map(ideaView),
		dateId: row.dateId,
	};
}

/** True when no Splurge is booked or done in the evening's calendar month. */
async function splurgeAllowed(db: Db, eveningDate: string): Promise<boolean> {
	const monthStart = `${eveningDate.slice(0, 7)}-01`;
	const next = new Date(`${monthStart}T12:00:00Z`);
	next.setUTCMonth(next.getUTCMonth() + 1);
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(dates)
		.where(
			and(
				inArray(dates.status, ["booked", "done"]),
				gt(dates.priceGbp, SPLURGE_OVER_GBP),
				gte(dates.on, monthStart),
				lt(dates.on, next.toISOString().slice(0, 10)),
			),
		);
	return (row?.n ?? 0) === 0;
}

async function pick(
	db: Db,
	deps: Deps,
	eveningDate: string,
	exclude: readonly string[],
): Promise<string[]> {
	const ranked = await rankedIdeas(db, deps, eveningDate);
	return pickShortlist(ranked, {
		splurgeAllowed: await splurgeAllowed(db, eveningDate),
		exclude: new Set(exclude),
	});
}

export async function weekRow(
	db: Db,
	weekStart: string,
): Promise<ShortlistRow | null> {
	const [row] = await db
		.select()
		.from(shortlists)
		.where(eq(shortlists.weekStart, weekStart));
	return row ?? null;
}

/** The week the Shortlist plans for now, made on first ask and the same on every later ask. */
export async function currentWeek(db: Db, deps: Deps): Promise<WeekView> {
	const weekStart = nextWeekMonday(deps.now());
	const existing = await weekRow(db, weekStart);
	if (existing) return view(db, existing);

	const from = londonTime(weekStart, "00:00");
	const to = londonTime(addDays(weekStart, 7), "00:00");
	const [busy, trips] = await Promise.all([deps.busy(from, to), deps.trips()]);
	const choice = chooseEvening(weekStart, busy, trips);

	let values: typeof shortlists.$inferInsert;
	if ("skip" in choice) {
		values = {
			weekStart,
			skipReason: choice.skip,
			ideaIds: [],
			offeredIds: [],
			status: "skipped",
		};
	} else {
		const ids = await pick(db, deps, choice.date, []);
		values = {
			weekStart,
			eveningDate: choice.date,
			ideaIds: ids,
			offeredIds: ids,
			status: ids.length > 0 ? "offered" : "exhausted",
		};
	}
	await db
		.insert(shortlists)
		.values(values)
		.onConflictDoNothing({ target: shortlists.weekStart });
	const row = await weekRow(db, weekStart);
	if (!row) throw new Error("shortlist insert returned no row");
	return view(db, row);
}

export class WeekStateError extends Error {}

/** None of the three fit: each loses some score and the next three come. */
export async function nextRound(db: Db, deps: Deps): Promise<WeekView> {
	const current = await currentWeek(db, deps);
	const row = await weekRow(db, current.weekStart);
	if (!row || row.status !== "offered" || !row.eveningDate)
		throw new WeekStateError(`the week is ${current.status}, not offered`);
	if (row.ideaIds.length > 0)
		await db
			.update(ideas)
			.set({ rejections: sql`${ideas.rejections} + 1` })
			.where(inArray(ideas.id, row.ideaIds));
	if (row.round + 1 >= MAX_ROUNDS) {
		await db
			.update(shortlists)
			.set({ status: "exhausted", ideaIds: [] })
			.where(eq(shortlists.weekStart, row.weekStart));
	} else {
		const ids = await pick(db, deps, row.eveningDate, row.offeredIds);
		await db
			.update(shortlists)
			.set({
				round: row.round + 1,
				ideaIds: ids,
				offeredIds: [...row.offeredIds, ...ids],
				status: ids.length > 0 ? "offered" : "exhausted",
			})
			.where(eq(shortlists.weekStart, row.weekStart));
	}
	const updated = await weekRow(db, row.weekStart);
	if (!updated) throw new Error("shortlist vanished");
	return view(db, updated);
}

/** One Idea has no table or ticket that evening: swap it for the next best, with no penalty. */
export async function replaceIdea(
	db: Db,
	deps: Deps,
	ideaId: string,
): Promise<WeekView> {
	const current = await currentWeek(db, deps);
	const row = await weekRow(db, current.weekStart);
	if (!row || row.status !== "offered" || !row.eveningDate)
		throw new WeekStateError(`the week is ${current.status}, not offered`);
	if (!row.ideaIds.includes(ideaId))
		throw new WeekStateError("that idea is not on this week's shortlist");
	const keep = row.ideaIds.filter((id) => id !== ideaId);
	const [replacement] = (
		await pick(db, deps, row.eveningDate, row.offeredIds)
	).filter((id) => !keep.includes(id));
	const ids = replacement
		? row.ideaIds.map((id) => (id === ideaId ? replacement : id))
		: keep;
	await db
		.update(shortlists)
		.set({
			ideaIds: ids.slice(0, SHORTLIST_SIZE),
			offeredIds: replacement
				? [...row.offeredIds, replacement]
				: row.offeredIds,
		})
		.where(eq(shortlists.weekStart, row.weekStart));
	const updated = await weekRow(db, row.weekStart);
	if (!updated) throw new Error("shortlist vanished");
	return view(db, updated);
}
