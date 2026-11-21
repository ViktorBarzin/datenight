/**
 * Dates: the booking Muse posts back, the two calendar events it makes, the
 * Rating after the evening, and Past dates confirmed from history.
 */

import { getLogger } from "@viktorbarzin/log";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";

import { londonDate } from "#/domain/evening";
import { buildEvent } from "#/domain/ical";
import type { Category } from "#/domain/types";
import {
	type DateRow,
	dates,
	historyCandidates,
	ideas,
	shortlists,
} from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { currentWeek } from "./week.server";

const log = getLogger("datenight.dates");

export interface DateView {
	id: string;
	ideaId: string | null;
	venue: string;
	activityKind: string;
	category: string;
	on: string;
	startsAt: string | null;
	endsAt: string | null;
	area: string;
	dressCode: string;
	bookingRef: string;
	bookingPlatform: string;
	priceGbp: number | null;
	notes: string;
	status: string;
	source: string;
	rating: number | null;
	ratingNote: string;
	calendar: "added" | "failed" | "none";
	calendarError: string | null;
}

export function dateView(row: DateRow): DateView {
	return {
		id: row.id,
		ideaId: row.ideaId,
		venue: row.venue,
		activityKind: row.activityKind,
		category: row.category,
		on: row.on,
		startsAt: row.startsAt?.toISOString() ?? null,
		endsAt: row.endsAt?.toISOString() ?? null,
		area: row.area,
		dressCode: row.dressCode,
		bookingRef: row.bookingRef,
		bookingPlatform: row.bookingPlatform,
		priceGbp: row.priceGbp,
		notes: row.notes,
		status: row.status,
		source: row.source,
		rating: row.rating,
		ratingNote: row.ratingNote,
		calendar: row.calendarError
			? "failed"
			: row.holdEventUid || row.ownerEventUid
				? "added"
				: "none",
		calendarError: row.calendarError,
	};
}

export class DateInputError extends Error {}

export interface Booking {
	ideaId: string;
	startsAt: Date;
	endsAt: Date | null;
	bookingRef: string;
	bookingPlatform: string;
	bookingEmail: string;
	priceGbp: number | null;
	dressCode: string;
	notes: string;
}

const DEFAULT_LENGTH_MS = 3 * 3_600_000;

/**
 * Two events go into the Owner's calendar: the Owner's own with the venue,
 * and the Surprise hold with the Partner as attendee, which Nextcloud mails
 * to her. The hold names the time, the rough area and the dress code only.
 */
async function addCalendarEvents(
	deps: Deps,
	row: DateRow,
): Promise<{
	owner: string | null;
	hold: string | null;
	error: string | null;
}> {
	if (!row.startsAt) return { owner: null, hold: null, error: "no start time" };
	const start = row.startsAt;
	const end = row.endsAt ?? new Date(start.getTime() + DEFAULT_LENGTH_MS);
	const now = deps.now();
	const ownerUid = `date-${row.id}@datenight`;
	const holdUid = `hold-${row.id}@datenight`;
	let owner: string | null = null;
	let hold: string | null = null;
	const errors: string[] = [];
	try {
		const details = [
			row.bookingRef &&
				`Booking ${row.bookingRef}${row.bookingPlatform ? ` on ${row.bookingPlatform}` : ""}`,
			row.bookingEmail && `Booked with ${row.bookingEmail}`,
			row.priceGbp !== null && `£${row.priceGbp} for two`,
			row.dressCode && `Dress code: ${row.dressCode}`,
			row.notes,
		]
			.filter(Boolean)
			.join("\n");
		await deps.putEvent(
			ownerUid,
			buildEvent({
				uid: ownerUid,
				start,
				end,
				summary: `Date: ${row.venue}`,
				description: details,
				location: row.venue,
				now,
			}),
		);
		owner = ownerUid;
	} catch (err) {
		errors.push(`own event: ${String(err)}`);
	}
	const { owner: who, partner } = deps.settings;
	if (who && partner) {
		try {
			const description = [
				"A surprise from me. Keep the evening free.",
				row.area && `Area: ${row.area}`,
				`Dress code: ${row.dressCode || "smart casual"}`,
			]
				.filter(Boolean)
				.join("\n");
			await deps.putEvent(
				holdUid,
				buildEvent({
					uid: holdUid,
					start,
					end,
					summary: "Surprise date",
					description,
					location: row.area || "London",
					organizer: who,
					attendees: [partner],
					now,
				}),
			);
			hold = holdUid;
		} catch (err) {
			errors.push(`surprise hold: ${String(err)}`);
		}
	} else {
		errors.push("surprise hold: owner or partner not set up");
	}
	return { owner, hold, error: errors.length > 0 ? errors.join("; ") : null };
}

export async function book(db: Db, deps: Deps, b: Booking): Promise<DateView> {
	const [idea] = await db.select().from(ideas).where(eq(ideas.id, b.ideaId));
	if (!idea) throw new DateInputError("no idea with that id");
	if (idea.status === "booked")
		throw new DateInputError("that idea is already booked");
	if (b.endsAt && b.endsAt <= b.startsAt)
		throw new DateInputError("ends_at must be after starts_at");

	const week = await currentWeek(db, deps);
	const row = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(dates)
			.values({
				ideaId: idea.id,
				venue: idea.venue,
				activityKind: idea.activityKind,
				category: idea.category,
				on: londonDate(b.startsAt),
				startsAt: b.startsAt,
				endsAt: b.endsAt,
				area: idea.area,
				dressCode: b.dressCode,
				bookingRef: b.bookingRef,
				bookingPlatform: b.bookingPlatform,
				bookingEmail: b.bookingEmail,
				priceGbp: b.priceGbp ?? idea.priceGbp,
				notes: b.notes,
				status: "booked",
				source: "app",
			})
			.returning();
		if (!inserted) throw new Error("date insert returned no row");
		await tx
			.update(ideas)
			.set({ status: "booked" })
			.where(eq(ideas.id, idea.id));
		if (week.status === "offered" || week.status === "exhausted")
			await tx
				.update(shortlists)
				.set({ status: "booked", dateId: inserted.id })
				.where(eq(shortlists.weekStart, week.weekStart));
		return inserted;
	});

	const cal = await addCalendarEvents(deps, row);
	if (cal.error)
		log.warn("calendar events incomplete", {
			date_id: row.id,
			error: cal.error,
		});
	const [updated] = await db
		.update(dates)
		.set({
			ownerEventUid: cal.owner,
			holdEventUid: cal.hold,
			calendarError: cal.error,
		})
		.where(eq(dates.id, row.id))
		.returning();
	return dateView(updated ?? row);
}

export async function cancel(
	db: Db,
	deps: Deps,
	id: string,
): Promise<DateView> {
	const [row] = await db.select().from(dates).where(eq(dates.id, id));
	if (!row) throw new DateInputError("no date with that id");
	if (row.status !== "booked")
		throw new DateInputError(`the date is ${row.status}, not booked`);
	for (const uid of [row.ownerEventUid, row.holdEventUid]) {
		if (!uid) continue;
		try {
			await deps.deleteEvent(uid);
		} catch (err) {
			log.warn("calendar event not removed", {
				date_id: id,
				error: String(err),
			});
		}
	}
	const [updated] = await db.transaction(async (tx) => {
		if (row.ideaId)
			await tx
				.update(ideas)
				.set({ status: "open" })
				.where(eq(ideas.id, row.ideaId));
		await tx
			.update(shortlists)
			.set({ status: "offered", dateId: null })
			.where(eq(shortlists.dateId, id));
		return tx
			.update(dates)
			.set({ status: "cancelled" })
			.where(eq(dates.id, id))
			.returning();
	});
	return dateView(updated ?? row);
}

/** Booked Dates whose evening is over and that have no Rating yet. */
export async function awaitingRating(db: Db, deps: Deps): Promise<DateView[]> {
	const rows = await db
		.select()
		.from(dates)
		.where(
			and(
				eq(dates.status, "booked"),
				lt(dates.startsAt, new Date(deps.now().getTime() - 4 * 3_600_000)),
				isNull(dates.rating),
			),
		)
		.orderBy(dates.startsAt);
	return rows.map(dateView);
}

export async function rate(
	db: Db,
	id: string,
	r: { happened: boolean; rating: number | null; note: string },
): Promise<DateView> {
	const [row] = await db.select().from(dates).where(eq(dates.id, id));
	if (!row) throw new DateInputError("no date with that id");
	if (r.happened && r.rating === null)
		throw new DateInputError("a date that happened needs a rating");
	const [updated] = await db
		.update(dates)
		.set(
			r.happened
				? { status: "done", rating: r.rating, ratingNote: r.note }
				: { status: "cancelled", ratingNote: r.note },
		)
		.where(eq(dates.id, id))
		.returning();
	return dateView(updated ?? row);
}

export async function favourites(db: Db): Promise<DateView[]> {
	const rows = await db
		.select()
		.from(dates)
		.where(and(eq(dates.status, "done"), eq(dates.rating, 5)))
		.orderBy(desc(dates.on));
	return rows.map(dateView);
}

export async function listDates(
	db: Db,
	statuses: readonly string[],
	limit: number,
): Promise<DateView[]> {
	const rows = await db
		.select()
		.from(dates)
		.where(inArray(dates.status, [...statuses]))
		.orderBy(desc(dates.on))
		.limit(limit);
	return rows.map(dateView);
}

export interface PastDateInput {
	on: string;
	venue: string;
	activityKind: string;
	category: Category;
	rating: number | null;
	note: string;
}

/** A Past date the Owner confirmed, from a history candidate or typed in. */
export async function addPastDate(
	db: Db,
	input: PastDateInput,
): Promise<DateView> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(dates)
			.values({
				venue: input.venue,
				activityKind: input.activityKind,
				category: input.category,
				on: input.on,
				status: "done",
				source: "history",
				rating: input.rating,
				ratingNote: input.note,
			})
			.returning();
		if (!row) throw new Error("date insert returned no row");
		await tx
			.update(historyCandidates)
			.set({ status: "confirmed" })
			.where(eq(historyCandidates.on, input.on));
		return dateView(row);
	});
}
