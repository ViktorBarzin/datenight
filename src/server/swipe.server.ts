/**
 * The swipe deck: open Ideas the Owner has not swiped yet, best first. A
 * right swipe likes an Idea (Liked list, first in the Shortlist); a left
 * swipe passes on it for good. Each swipe nudges the taste, and a deck
 * running low starts a refill Scout run.
 */
import { and, eq, inArray } from "drizzle-orm";

import { londonDate } from "#/domain/evening";
import { ideas } from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";
import { ideasByIds, rankedIdeas } from "./ideas.server";
import { maybeRefill } from "./jobs.server";
import { type IdeaView, ideaView } from "./week.server";

export interface DeckView {
	ideas: IdeaView[];
	/** All unswiped Ideas, not only the ones sent. */
	left: number;
	/** A refill Scout run was started by this call. */
	refilling: boolean;
}

export async function deck(
	db: Db,
	deps: Deps,
	limit: number,
): Promise<DeckView> {
	const ranked = await rankedIdeas(db, deps, londonDate(deps.now()), {
		unswipedOnly: true,
	});
	const rows = await ideasByIds(
		db,
		ranked.slice(0, limit).map((i) => i.id),
	);
	const refilling = await maybeRefill(db, deps, ranked.length);
	return { ideas: rows.map(ideaView), left: ranked.length, refilling };
}

export class SwipeError extends Error {}

export async function swipe(
	db: Db,
	deps: Deps,
	id: string,
	direction: "like" | "pass",
): Promise<{ left: number; refilling: boolean }> {
	const rows = await db
		.update(ideas)
		.set({
			reaction: direction,
			reactedAt: deps.now(),
			...(direction === "pass" ? { status: "dismissed" } : {}),
		})
		.where(and(eq(ideas.id, id), eq(ideas.status, "open")))
		.returning({ id: ideas.id });
	if (rows.length === 0) throw new SwipeError("that idea is not open");
	const left = (
		await rankedIdeas(db, deps, londonDate(deps.now()), { unswipedOnly: true })
	).length;
	return { left, refilling: await maybeRefill(db, deps, left) };
}

/** Take back the last swipe on an Idea. */
export async function undoSwipe(db: Db, id: string): Promise<void> {
	await db
		.update(ideas)
		.set({ reaction: null, reactedAt: null, status: "open" })
		.where(and(eq(ideas.id, id), inArray(ideas.status, ["open", "dismissed"])));
}
