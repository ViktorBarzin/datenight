/**
 * Server functions for the app's own pages (internal RPC; Muse uses
 * /api/muse). Every one starts with requireMember, and the app's users group
 * holds only the Owner.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { CLIENT_ID_HEADER } from "@viktorbarzin/realtime/client";
import { sanitizeClientId } from "@viktorbarzin/realtime/server";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

import { nextWeekMonday } from "#/domain/evening";
import { CATEGORIES } from "#/domain/types";
import { ideaKeys } from "#/lib/query-keys";
import { requireMember } from "./auth.server";
import {
	addPastDate,
	awaitingRating,
	cancel,
	type DateView,
	listDates,
	rate,
} from "./dates.server";
import { dates, historyCandidates } from "./db/schema.server";
import { pool } from "./db.server";
import { liveDeps } from "./deps.server";
import { realtimeEnabled } from "./env.server";
import {
	addIdeas,
	listIdeas,
	openIdeaCount,
	setIdeaStatus,
} from "./ideas.server";
import { recentRuns, runNow } from "./jobs.server";
import {
	addLink,
	type LinkView,
	processLink,
	recentLinks,
	retryLink,
} from "./links.server";
import { realtime } from "./realtime.server";
import {
	currentWeek,
	type IdeaView,
	ideaView,
	type WeekView,
	weekRow,
} from "./week.server";

/** Tell every open Ideas page to refetch; the writing tab skips its own event. */
async function ideasChanged(request: Request): Promise<void> {
	if (!realtimeEnabled()) return;
	const source = sanitizeClientId(request.headers.get(CLIENT_ID_HEADER));
	await realtime.publish(null, {
		type: "invalidate",
		keys: [ideaKeys.all],
		source,
	});
}

export interface HomeView {
	week: WeekView | null;
	nextWeekStart: string;
	upcoming: DateView[];
	toRate: DateView[];
	openIdeas: number;
	runs: { name: string; startedAt: string; outcome: string; detail: string }[];
	setup: Record<string, boolean>;
}

export const getHome = createServerFn({ method: "GET" }).handler(
	async (): Promise<HomeView> => {
		await requireMember(getRequest());
		const db = pool.getDb();
		const deps = liveDeps();
		const nextWeekStart = nextWeekMonday(deps.now());
		const row = await weekRow(db, nextWeekStart);
		const s = deps.settings;
		return {
			// Peek only: the Shortlist is made on Monday, after Sunday's Scout run.
			week: row ? await currentWeek(db, deps) : null,
			nextWeekStart,
			upcoming: (await listDates(db, ["booked"], 10)).reverse(),
			toRate: await awaitingRating(db, deps),
			openIdeas: await openIdeaCount(db, deps),
			runs: (await recentRuns(db, 6)).map((r) => ({
				name: r.name,
				startedAt: r.startedAt.toISOString(),
				outcome: r.outcome,
				detail: r.detail,
			})),
			setup: {
				muse: s.museToken !== null,
				scout: s.scout !== null,
				calendar: s.caldav !== null,
				"surprise hold": s.owner !== null && s.partner !== null,
				trips: s.tripitFeedUrl !== null,
				bank: s.actual !== null,
				photos: s.immich !== null,
			},
		};
	},
);

/** Make next week's Shortlist now, without waiting for Monday. */
export const makeWeekNow = createServerFn({ method: "POST" }).handler(
	async (): Promise<WeekView> => {
		await requireMember(getRequest());
		return currentWeek(pool.getDb(), liveDeps());
	},
);

export const runJob = createServerFn({ method: "POST" })
	.validator(z.object({ name: z.enum(["scout", "history"]) }))
	.handler(async ({ data }): Promise<string> => {
		await requireMember(getRequest());
		return runNow(pool.getDb(), liveDeps(), data.name);
	});

export const getIdeas = createServerFn({ method: "GET" })
	.validator(
		z.object({ status: z.enum(["open", "dismissed", "booked", "repeat"]) }),
	)
	.handler(async ({ data }): Promise<IdeaView[]> => {
		await requireMember(getRequest());
		return (await listIdeas(pool.getDb(), data.status, 300)).map(ideaView);
	});

export const setIdea = createServerFn({ method: "POST" })
	.validator(
		z.object({ id: z.string().uuid(), status: z.enum(["open", "dismissed"]) }),
	)
	.handler(async ({ data }): Promise<boolean> => {
		const request = getRequest();
		await requireMember(request);
		const changed = await setIdeaStatus(pool.getDb(), data.id, data.status);
		await ideasChanged(request);
		return changed;
	});

export const saveIdea = createServerFn({ method: "POST" })
	.validator(
		z.object({
			title: z.string().trim().min(1).max(200),
			venue: z.string().trim().min(1).max(200),
			category: z.enum(CATEGORIES),
			activityKind: z.string().trim().min(1).max(100),
			priceGbp: z.number().int().min(0).max(5000).nullable(),
			area: z.string().trim().max(100),
			postcode: z.string().trim().max(12),
			url: z.string().trim().max(2000),
		}),
	)
	.handler(async ({ data }) => {
		const request = getRequest();
		await requireMember(request);
		const result = await addIdeas(pool.getDb(), liveDeps(), [data], "saved");
		await ideasChanged(request);
		return result;
	});

export interface HistoryView {
	candidates: {
		on: string;
		venueGuess: string;
		evidence: { source: string; text: string }[];
	}[];
	past: DateView[];
}

export const getHistory = createServerFn({ method: "GET" }).handler(
	async (): Promise<HistoryView> => {
		await requireMember(getRequest());
		const db = pool.getDb();
		const datedDays = (await db.select({ on: dates.on }).from(dates)).map(
			(d) => d.on,
		);
		const candidates = await db
			.select()
			.from(historyCandidates)
			.where(
				datedDays.length > 0
					? and(
							eq(historyCandidates.status, "pending"),
							notInArray(historyCandidates.on, datedDays),
						)
					: eq(historyCandidates.status, "pending"),
			)
			.orderBy(desc(historyCandidates.on))
			.limit(200);
		return {
			candidates: candidates.map((c) => ({
				on: c.on,
				venueGuess: c.venueGuess,
				evidence: c.evidence,
			})),
			past: await listDates(db, ["done", "booked"], 300),
		};
	},
);

const pastDateSchema = z.object({
	on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	venue: z.string().trim().min(1).max(200),
	activityKind: z.string().trim().min(1).max(100),
	category: z.enum(CATEGORIES),
	rating: z.number().int().min(1).max(5).nullable(),
	note: z.string().trim().max(1000),
});

export const confirmPastDate = createServerFn({ method: "POST" })
	.validator(pastDateSchema)
	.handler(async ({ data }): Promise<DateView> => {
		await requireMember(getRequest());
		return addPastDate(pool.getDb(), data);
	});

export const dismissCandidate = createServerFn({ method: "POST" })
	.validator(z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
	.handler(async ({ data }): Promise<void> => {
		await requireMember(getRequest());
		await pool
			.getDb()
			.update(historyCandidates)
			.set({ status: "dismissed" })
			.where(eq(historyCandidates.on, data.on));
	});

export const rateDate = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.string().uuid(),
			happened: z.boolean(),
			rating: z.number().int().min(1).max(5).nullable(),
			note: z.string().trim().max(1000),
		}),
	)
	.handler(async ({ data }): Promise<DateView> => {
		await requireMember(getRequest());
		return rate(pool.getDb(), data.id, data);
	});

export const cancelDate = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }): Promise<DateView> => {
		await requireMember(getRequest());
		return cancel(pool.getDb(), liveDeps(), data.id);
	});

/** Paste a link: it is read into an Idea in the background. */
export const submitLink = createServerFn({ method: "POST" })
	.validator(
		z.object({
			url: z.string().trim().min(1).max(4000),
			note: z.string().trim().max(1000),
		}),
	)
	.handler(async ({ data }): Promise<LinkView> => {
		await requireMember(getRequest());
		const db = pool.getDb();
		const deps = liveDeps();
		const link = await addLink(db, {
			url: data.url,
			note: data.note,
			via: "app",
		});
		if (link.status === "pending" && deps.settings.link)
			void processLink(db, deps, link.id).catch(() => {});
		return link;
	});

export const getLinks = createServerFn({ method: "GET" }).handler(
	async (): Promise<LinkView[]> => {
		await requireMember(getRequest());
		return recentLinks(pool.getDb(), 10);
	},
);

export const tryLinkAgain = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.string().uuid() }))
	.handler(async ({ data }): Promise<void> => {
		await requireMember(getRequest());
		const db = pool.getDb();
		const deps = liveDeps();
		await retryLink(db, data.id);
		if (deps.settings.link) void processLink(db, deps, data.id).catch(() => {});
	});
