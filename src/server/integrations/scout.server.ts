/**
 * The Scout run: claude-agent-service's date-scout agent reads London
 * listing sites and answers with new Ideas. The call is synchronous and can
 * take several minutes. The agent's answer is untrusted text, so every field
 * passes the schema below before it reaches the database.
 */
import { z } from "zod";

import { CATEGORIES } from "#/domain/types";
import type { DateNightSettings } from "../env.server";

const RUN_TIMEOUT_MS = 20 * 60_000;

const text = (max: number) => z.string().trim().max(max);
const url = z
	.string()
	.trim()
	.max(2000)
	.refine((v) => v === "" || /^https?:\/\//.test(v), "must be an http(s) URL");

export const scoutIdea = z.object({
	title: text(200).min(1),
	venue: text(200).min(1),
	address: text(300).default(""),
	area: text(100).default(""),
	postcode: text(12).default(""),
	category: z.enum(CATEGORIES),
	activity_kind: text(100).min(1),
	price_gbp_for_two: z.number().int().min(0).max(5000).nullable().default(null),
	url: url.default(""),
	booking_url: url.default(""),
	description: text(600).default(""),
	why: text(400).default(""),
	ends_on: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable()
		.default(null),
});
export type ScoutIdea = z.infer<typeof scoutIdea>;

/** Keep each idea that passes the schema and drop the rest, with a count. */
export function parseScoutIdeas(raw: unknown): {
	ideas: ScoutIdea[];
	dropped: number;
} {
	const list = z.object({ ideas: z.array(z.unknown()) }).parse(raw).ideas;
	const ideas: ScoutIdea[] = [];
	for (const item of list) {
		const parsed = scoutIdea.safeParse(item);
		if (parsed.success) ideas.push(parsed.data);
	}
	return { ideas, dropped: list.length - ideas.length };
}

export async function runScout(
	cfg: NonNullable<DateNightSettings["scout"]>,
	today: string,
): Promise<{ ideas: ScoutIdea[]; dropped: number }> {
	const res = await fetch(cfg.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${cfg.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ today }),
		signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
	});
	if (!res.ok)
		throw new Error(
			`scout answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
		);
	return parseScoutIdeas(await res.json());
}
