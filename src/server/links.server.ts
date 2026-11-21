/**
 * Saved links: the Owner pastes or forwards a link, the agent service turns
 * it into an Idea, and the photo crawl gives it photos. One attempt per link;
 * a failed one waits for "Try again".
 */
import { getLogger } from "@viktorbarzin/log";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";

import { ideas, type SavedLinkRow, savedLinks } from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { addIdeas, fromScout } from "./ideas.server";
import { findPhotos } from "./photos.server";

const log = getLogger("datenight.links");

export class LinkInputError extends Error {}

export interface LinkView {
	id: string;
	url: string;
	note: string;
	via: string;
	status: string;
	reason: string;
	ideaId: string | null;
	ideaTitle: string | null;
	createdAt: string;
}

export function normalizeLink(raw: string): string {
	const text = raw.trim();
	const match = /https?:\/\/\S+/i.exec(text);
	if (!match) throw new LinkInputError("that is not a link");
	let url: URL;
	try {
		url = new URL(match[0].replace(/[).,]+$/, ""));
	} catch {
		throw new LinkInputError("that is not a link");
	}
	// Tracking parameters make the same post look like a new link.
	for (const p of [...url.searchParams.keys()])
		if (/^(utm_|igsh|igshid|si$|_r$|_t$|fbclid|gclid)/i.test(p))
			url.searchParams.delete(p);
	url.hash = "";
	const out = url.toString();
	if (out.length > 2000) throw new LinkInputError("that link is too long");
	return out;
}

async function views(db: Db, rows: SavedLinkRow[]): Promise<LinkView[]> {
	const titles = new Map<string, string>();
	for (const r of rows) {
		if (!r.ideaId || titles.has(r.ideaId)) continue;
		const [idea] = await db
			.select({ title: ideas.title })
			.from(ideas)
			.where(eq(ideas.id, r.ideaId));
		if (idea) titles.set(r.ideaId, idea.title);
	}
	return rows.map((r) => ({
		id: r.id,
		url: r.url,
		note: r.note,
		via: r.via,
		status: r.status,
		reason: r.reason,
		ideaId: r.ideaId,
		ideaTitle: r.ideaId ? (titles.get(r.ideaId) ?? null) : null,
		createdAt: r.createdAt.toISOString(),
	}));
}

/** Record a link; the same link sent again within a day returns the first record. */
export async function addLink(
	db: Db,
	input: { url: string; note: string; via: "app" | "muse" },
): Promise<LinkView> {
	const url = normalizeLink(input.url);
	const [recent] = await db
		.select()
		.from(savedLinks)
		.where(
			and(
				eq(savedLinks.url, url),
				gt(savedLinks.createdAt, new Date(Date.now() - 86_400_000)),
			),
		)
		.orderBy(desc(savedLinks.createdAt))
		.limit(1);
	if (recent && recent.status !== "failed")
		return (await views(db, [recent]))[0] as LinkView;
	const [row] = await db
		.insert(savedLinks)
		.values({ url, note: input.note.trim().slice(0, 1000), via: input.via })
		.returning();
	if (!row) throw new Error("link insert returned no row");
	return (await views(db, [row]))[0] as LinkView;
}

export async function linkById(db: Db, id: string): Promise<LinkView | null> {
	const [row] = await db.select().from(savedLinks).where(eq(savedLinks.id, id));
	return row ? ((await views(db, [row]))[0] ?? null) : null;
}

export async function recentLinks(db: Db, limit: number): Promise<LinkView[]> {
	return views(
		db,
		await db
			.select()
			.from(savedLinks)
			.orderBy(desc(savedLinks.createdAt))
			.limit(limit),
	);
}

export async function retryLink(db: Db, id: string): Promise<void> {
	await db
		.update(savedLinks)
		.set({ status: "pending", reason: "" })
		.where(
			and(
				eq(savedLinks.id, id),
				inArray(savedLinks.status, ["failed", "not_found"]),
			),
		);
}

/** Read one pending link into an Idea. Claims it first, so it runs once. */
export async function processLink(
	db: Db,
	deps: Deps,
	id: string,
): Promise<void> {
	const [link] = await db
		.update(savedLinks)
		.set({ status: "reading", attempts: 1 })
		.where(and(eq(savedLinks.id, id), eq(savedLinks.status, "pending")))
		.returning();
	if (!link) return;
	const finish = (set: Partial<typeof savedLinks.$inferInsert>) =>
		db
			.update(savedLinks)
			.set({ ...set, finishedAt: new Date() })
			.where(eq(savedLinks.id, id));
	try {
		const answer = await deps.readLink(link.url, link.note);
		if (!answer.found || !answer.idea) {
			await finish({
				status: "not_found",
				reason: answer.reason || "no date idea in that link",
			});
			return;
		}
		const result = await addIdeas(db, deps, [fromScout(answer.idea)], "saved");
		const ideaId = result.ids[0] ?? null;
		if (ideaId) {
			const photos = await findPhotos(db, deps, {
				copyFirst: answer.social?.thumbnails ?? [],
				pages: [
					...answer.photo_pages,
					answer.idea.url,
					answer.idea.booking_url,
				],
			});
			await db.update(ideas).set({ photos }).where(eq(ideas.id, ideaId));
		}
		await finish({
			status: "done",
			ideaId,
			reason:
				result.repeats > 0
					? "you did this before, so it stays out of the shortlist"
					: "",
		});
	} catch (err) {
		log.warn("link failed", { link_id: id, error: String(err) });
		await finish({ status: "failed", reason: String(err).slice(0, 300) });
	}
}

/** Pending links, oldest first, one at a time. A read cut off by a restart becomes failed. */
export async function processPending(db: Db, deps: Deps): Promise<number> {
	await db
		.update(savedLinks)
		.set({
			status: "failed",
			reason: "interrupted; try again",
			finishedAt: new Date(),
		})
		.where(
			and(
				eq(savedLinks.status, "reading"),
				lt(savedLinks.createdAt, new Date(Date.now() - 20 * 60_000)),
			),
		);
	const rows = await db
		.select({ id: savedLinks.id })
		.from(savedLinks)
		.where(eq(savedLinks.status, "pending"))
		.orderBy(asc(savedLinks.createdAt))
		.limit(5);
	for (const r of rows) await processLink(db, deps, r.id);
	return rows.length;
}
