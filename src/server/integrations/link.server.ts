/**
 * Turning a link into an idea: claude-agent-service's date-link agent reads
 * an Instagram or TikTok post's caption with yt-dlp, or any page, and finds
 * the venue, its price and pages with photos. Its answer is untrusted text,
 * so every field passes a schema before it reaches the database.
 */
import { z } from "zod";

import type { DateNightSettings } from "../env.server";
import { scoutIdea } from "./scout.server";

const RUN_TIMEOUT_MS = 10 * 60_000;

const httpUrl = z
	.string()
	.max(2000)
	.refine((v) => /^https?:\/\//.test(v));

export const linkAnswer = z.object({
	found: z.boolean(),
	reason: z.string().max(500).default(""),
	idea: scoutIdea.nullable().default(null),
	photo_pages: z
		.array(z.string())
		.default([])
		.transform((pages) =>
			pages.filter((p) => httpUrl.safeParse(p).success).slice(0, 6),
		),
	social: z
		.object({
			caption: z.string().max(4000).default(""),
			uploader: z.string().max(200).default(""),
			thumbnails: z
				.array(z.string())
				.default([])
				.transform((t) =>
					t.filter((u) => httpUrl.safeParse(u).success).slice(0, 4),
				),
		})
		.nullable()
		.default(null),
});
export type LinkAnswer = z.infer<typeof linkAnswer>;

export async function readLink(
	cfg: NonNullable<DateNightSettings["link"]>,
	url: string,
	note: string,
): Promise<LinkAnswer> {
	const res = await fetch(cfg.url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${cfg.token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ url, note }),
		signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
	});
	if (!res.ok)
		throw new Error(
			`link reader answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
		);
	return linkAnswer.parse(await res.json());
}
