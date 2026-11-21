/**
 * The app's Drizzle schema: the identity tables from @viktorbarzin/auth plus
 * this app's own tables. `bun run db:generate` writes migrations to drizzle/.
 * Migrations are additive (expand, then contract in a later release), so the
 * previous image stays a working rollback.
 */
import {
	customType,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

export * from "@viktorbarzin/auth/schema";

/**
 * The app's own tables. The app has one Owner, so no table carries an owner
 * column; every member of the app's users group sees the same data
 * (GLOSSARY.md has the words).
 */

const created = () =>
	timestamp("created_at", { withTimezone: true, mode: "date" })
		.defaultNow()
		.notNull();

/** An Idea: something the couple could do together. */
export const ideas = pgTable(
	"ideas",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		title: text("title").notNull(),
		venue: text("venue").notNull(),
		address: text("address").notNull().default(""),
		area: text("area").notNull().default(""),
		postcode: text("postcode").notNull().default(""),
		lat: doublePrecision("lat"),
		lon: doublePrecision("lon"),
		/** One of CATEGORIES in src/domain/types.ts. */
		category: varchar("category", { length: 16 }).notNull(),
		activityKind: text("activity_kind").notNull(),
		/** For the couple, whole pounds; null when unknown. */
		priceGbp: integer("price_gbp"),
		url: text("url").notNull().default(""),
		bookingUrl: text("booking_url").notNull().default(""),
		description: text("description").notNull().default(""),
		why: text("why").notNull().default(""),
		/** scout | saved */
		source: varchar("source", { length: 16 }).notNull(),
		/** open | dismissed | booked | repeat */
		status: varchar("status", { length: 16 }).notNull().default("open"),
		rejections: integer("rejections").notNull().default(0),
		/** The Owner's swipe: like or pass; null until swiped. A pass also dismisses. */
		reaction: varchar("reaction", { length: 8 }),
		reactedAt: timestamp("reacted_at", { withTimezone: true, mode: "date" }),
		/** The last day the Idea can happen, for dated events. */
		endsOn: date("ends_on", { mode: "string" }),
		/**
		 * Photo links, best first: an outside image URL, or /api/photos/<id> for
		 * a copy the app keeps. null until the photo crawl has looked.
		 */
		photos: jsonb("photos").$type<string[]>(),
		/** Normalised venue and title, so a scout run never adds the same Idea twice. */
		dedupeKey: text("dedupe_key").notNull(),
		createdAt: created(),
	},
	(t) => [
		uniqueIndex("ideas_dedupe_key_idx").on(t.dedupeKey),
		index("ideas_status_idx").on(t.status),
	],
);

/** A Date, booked or done, and the Past dates the Owner confirmed from history. */
export const dates = pgTable(
	"dates",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ideaId: uuid("idea_id").references(() => ideas.id),
		venue: text("venue").notNull(),
		activityKind: text("activity_kind").notNull(),
		category: varchar("category", { length: 16 }).notNull(),
		on: date("on", { mode: "string" }).notNull(),
		startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
		endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
		area: text("area").notNull().default(""),
		dressCode: text("dress_code").notNull().default(""),
		bookingRef: text("booking_ref").notNull().default(""),
		bookingPlatform: text("booking_platform").notNull().default(""),
		bookingEmail: text("booking_email").notNull().default(""),
		priceGbp: integer("price_gbp"),
		notes: text("notes").notNull().default(""),
		/** booked | done | cancelled */
		status: varchar("status", { length: 16 }).notNull(),
		/** app | history */
		source: varchar("source", { length: 16 }).notNull(),
		rating: integer("rating"),
		ratingNote: text("rating_note").notNull().default(""),
		/** The Owner's own calendar event, and the Surprise hold sent to the Partner. */
		ownerEventUid: text("owner_event_uid"),
		holdEventUid: text("hold_event_uid"),
		calendarError: text("calendar_error"),
		createdAt: created(),
	},
	(t) => [
		index("dates_on_idx").on(t.on),
		index("dates_status_idx").on(t.status),
	],
);

/** A possible Past date found in the calendar, the bank or the photos. */
export const historyCandidates = pgTable("history_candidates", {
	on: date("on", { mode: "string" }).primaryKey(),
	venueGuess: text("venue_guess").notNull(),
	/** [{source, text}] */
	evidence: jsonb("evidence")
		.$type<{ source: string; text: string }[]>()
		.notNull(),
	/** pending | confirmed | dismissed */
	status: varchar("status", { length: 16 }).notNull().default("pending"),
	createdAt: created(),
});

/** The Shortlist for one week, and what came of it. */
export const shortlists = pgTable("shortlists", {
	/** The Monday of the week the Date evening falls in. */
	weekStart: date("week_start", { mode: "string" }).primaryKey(),
	eveningDate: date("evening_date", { mode: "string" }),
	/** busy | travel, when the week is a Skipped week. */
	skipReason: varchar("skip_reason", { length: 16 }),
	/** 0 for the first three Ideas, 1 and 2 after the Owner said none fit. */
	round: integer("round").notNull().default(0),
	ideaIds: jsonb("idea_ids").$type<string[]>().notNull(),
	/** Every Idea offered this week, so a new round never repeats one. */
	offeredIds: jsonb("offered_ids").$type<string[]>().notNull(),
	/** offered | booked | skipped | exhausted */
	status: varchar("status", { length: 16 }).notNull(),
	dateId: uuid("date_id").references(() => dates.id),
	createdAt: created(),
});

/** One row per scheduled job and period, claimed before the job runs. */
export const jobRuns = pgTable(
	"job_runs",
	{
		name: varchar("name", { length: 32 }).notNull(),
		periodKey: varchar("period_key", { length: 32 }).notNull(),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
			.defaultNow()
			.notNull(),
		finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
		/** running | ok | failed */
		outcome: varchar("outcome", { length: 16 }).notNull().default("running"),
		detail: text("detail").notNull().default(""),
	},
	(t) => [primaryKey({ columns: [t.name, t.periodKey] })],
);

const bytea = customType<{
	data: Uint8Array<ArrayBuffer>;
	driverData: Uint8Array<ArrayBuffer>;
}>({
	dataType: () => "bytea",
});

/** A copy of a photo whose outside link expires (Instagram, TikTok). */
export const storedPhotos = pgTable("stored_photos", {
	id: uuid("id").primaryKey().defaultRandom(),
	contentType: varchar("content_type", { length: 64 }).notNull(),
	bytes: bytea("bytes").notNull(),
	sourceUrl: text("source_url").notNull(),
	createdAt: created(),
});

/** A link the Owner sent in, and what came of it. */
export const savedLinks = pgTable(
	"saved_links",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		url: text("url").notNull(),
		note: text("note").notNull().default(""),
		/** app | muse */
		via: varchar("via", { length: 16 }).notNull(),
		/** pending | reading | done | not_found | failed */
		status: varchar("status", { length: 16 }).notNull().default("pending"),
		ideaId: uuid("idea_id").references(() => ideas.id),
		/** Why it was not found or failed, in words. */
		reason: text("reason").notNull().default(""),
		attempts: integer("attempts").notNull().default(0),
		createdAt: created(),
		finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
	},
	(t) => [index("saved_links_status_idx").on(t.status)],
);

export type IdeaRow = typeof ideas.$inferSelect;
export type DateRow = typeof dates.$inferSelect;
export type ShortlistRow = typeof shortlists.$inferSelect;
export type HistoryCandidateRow = typeof historyCandidates.$inferSelect;
export type SavedLinkRow = typeof savedLinks.$inferSelect;
