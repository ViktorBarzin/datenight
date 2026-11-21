/**
 * Background work, run inside the one web pod: the Sunday Scout run and the
 * history refresh before it. Each run claims a row in job_runs first, so a
 * restart or a second pod never runs the same period twice.
 */

import { getLogger } from "@viktorbarzin/log";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { addDays, londonDate, londonTime, mondayOf } from "#/domain/evening";
import { awayDays, candidatesFrom } from "#/domain/history";
import { historyCandidates, jobRuns } from "./db/schema.server";
import type { Db } from "./db.server";
import { type Deps, NotConfigured } from "./deps.server";
import { addIdeas, fromScout } from "./ideas.server";
import { calendarEvents } from "./integrations/caldav.server";
import { runScout } from "./integrations/scout.server";
import { eveningPhotoDays, spendSince } from "./integrations/sources.server";

const log = getLogger("datenight.jobs");

/** Claim a job for a period; false when it already ran or runs. */
async function claim(
	db: Db,
	name: string,
	periodKey: string,
): Promise<boolean> {
	const rows = await db
		.insert(jobRuns)
		.values({ name, periodKey })
		.onConflictDoNothing()
		.returning({ name: jobRuns.name });
	return rows.length > 0;
}

async function finish(
	db: Db,
	name: string,
	periodKey: string,
	outcome: "ok" | "failed",
	detail: string,
): Promise<void> {
	await db
		.update(jobRuns)
		.set({ outcome, detail: detail.slice(0, 2000), finishedAt: new Date() })
		.where(and(eq(jobRuns.name, name), eq(jobRuns.periodKey, periodKey)));
}

async function runClaimed(
	db: Db,
	name: string,
	periodKey: string,
	work: () => Promise<string>,
): Promise<string> {
	try {
		const detail = await work();
		await finish(db, name, periodKey, "ok", detail);
		log.info(`${name} finished`, { period: periodKey, detail });
		return detail;
	} catch (err) {
		await finish(db, name, periodKey, "failed", String(err));
		log.error(`${name} failed`, { period: periodKey, error: String(err) });
		throw err;
	}
}

export async function scoutNow(db: Db, deps: Deps): Promise<string> {
	const scout = deps.settings.scout;
	if (!scout) throw new NotConfigured("the scout");
	const { ideas, dropped } = await runScout(scout, londonDate(deps.now()));
	const result = await addIdeas(db, deps, ideas.map(fromScout), "scout");
	return `found ${ideas.length} (dropped ${dropped} malformed): ${result.added} new, ${result.repeats} repeats, ${result.duplicates} already known`;
}

export async function refreshHistory(db: Db, deps: Deps): Promise<string> {
	const { caldav, actual, immich, historySince } = deps.settings;
	const until = deps.now();
	const parts: string[] = [];
	const events = caldav
		? (await calendarEvents(caldav, londonTime(historySince, "00:00"), until))
				.filter((e) => !e.allDay)
				.map((e) => ({
					on: londonDate(e.start),
					startHour: Number(
						new Intl.DateTimeFormat("en-GB", {
							timeZone: "Europe/London",
							hour: "2-digit",
							hourCycle: "h23",
						}).format(e.start),
					),
					summary: e.summary,
					location: e.location,
				}))
				.filter(
					(e) =>
						!e.summary.startsWith("Date: ") && e.summary !== "Surprise date",
				)
		: [];
	parts.push(`calendar ${caldav ? events.length : "not set up"}`);
	const spends = actual ? await spendSince(actual, historySince) : [];
	parts.push(`bank ${actual ? spends.length : "not set up"}`);
	const photoDays = immich ? await eveningPhotoDays(immich, historySince) : [];
	parts.push(`photo days ${immich ? photoDays.length : "not set up"}`);

	const away = awayDays(await deps.trips());
	parts.push(`${away.size} evenings away`);
	const found = candidatesFrom({ events, spends, photoDays }).filter(
		(c) => c.on < londonDate(until) && !away.has(c.on),
	);
	// Undecided days that turned out to be trips leave the list.
	if (away.size > 0)
		await db
			.delete(historyCandidates)
			.where(
				and(
					eq(historyCandidates.status, "pending"),
					inArray(historyCandidates.on, [...away]),
				),
			);
	for (const c of found) {
		await db
			.insert(historyCandidates)
			.values({ on: c.on, venueGuess: c.venueGuess, evidence: c.evidence })
			.onConflictDoUpdate({
				target: historyCandidates.on,
				set: { venueGuess: c.venueGuess, evidence: c.evidence },
				// A decided day keeps its decision.
				setWhere: sql`${historyCandidates.status} = 'pending'`,
			});
	}
	return `${parts.join(", ")}; ${found.length} possible past dates`;
}

/**
 * Start a job by hand, for the page's buttons, and return at once: a Scout
 * run takes minutes, longer than a browser request lives. The page shows the
 * outcome from job_runs. Refused while the same job runs.
 */
export async function runNow(
	db: Db,
	deps: Deps,
	name: "scout" | "history",
): Promise<string> {
	const periodKey = `manual-${deps.now().toISOString()}`;
	const [running] = await db
		.select()
		.from(jobRuns)
		.where(
			and(
				eq(jobRuns.name, name),
				eq(jobRuns.outcome, "running"),
				sql`${jobRuns.startedAt} > now() - interval '30 minutes'`,
			),
		);
	if (running) throw new Error(`${name} is already running`);
	if (name === "scout" && !deps.settings.scout)
		throw new NotConfigured("the scout");
	await claim(db, name, periodKey);
	void runClaimed(db, name, periodKey, () =>
		name === "scout" ? scoutNow(db, deps) : refreshHistory(db, deps),
	).catch(() => {});
	return `${name} started`;
}

/**
 * One scheduler tick. On Sunday from 19:00 London time the history refresh
 * runs, and from 20:00 the Scout run, once per week each. A Monday morning
 * tick catches up a run the pod missed.
 */
export async function tick(db: Db, deps: Deps): Promise<void> {
	const now = deps.now();
	const today = londonDate(now);
	const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
	const sunday = weekday === 6 ? today : addDays(mondayOf(today), -1);
	const key = sunday;
	const due = (time: string) =>
		now >= londonTime(sunday, time) &&
		now < londonTime(addDays(sunday, 1), "09:00");

	if (due("19:00") && (await claim(db, "history", key))) {
		await runClaimed(db, "history", key, () => refreshHistory(db, deps)).catch(
			() => {},
		);
	}
	if (due("20:00") && deps.settings.scout && (await claim(db, "scout", key))) {
		await runClaimed(db, "scout", key, () => scoutNow(db, deps)).catch(
			() => {},
		);
	}
}

export async function recentRuns(db: Db, limit: number) {
	return db
		.select()
		.from(jobRuns)
		.orderBy(desc(jobRuns.startedAt))
		.limit(limit);
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function startScheduler(
	db: () => Db,
	deps: () => Deps,
	everyMs = 5 * 60_000,
): void {
	if (timer) return;
	const run = async () => {
		if (ticking) return;
		ticking = true;
		try {
			await tick(db(), deps());
		} catch (err) {
			log.error("scheduler tick failed", { error: String(err) });
		} finally {
			ticking = false;
		}
	};
	timer = setInterval(run, everyMs);
	setTimeout(run, 30_000);
}

export function stopScheduler(): void {
	if (timer) clearInterval(timer);
	timer = null;
}
