/**
 * The API Muse calls (docs/adr/0001-muse-drives-the-week.md). Muse holds one
 * static bearer token, MUSE_TOKEN, because it cannot run an OIDC flow from
 * its own connector; the token opens /api/muse/* and nothing else. Every
 * body passes a zod schema, and answers use the /api error envelope.
 */
import { timingSafeEqual } from "node:crypto";
import { getLogger } from "@viktorbarzin/log";
import {
	ApiError,
	createErrorResponder,
	errorResponse,
	readJson,
} from "@viktorbarzin/runtime";
import { z } from "zod";

import { CATEGORIES } from "#/domain/types";
import {
	awaitingRating,
	book,
	cancel,
	DateInputError,
	favourites,
	rate,
} from "./dates.server";
import { pool } from "./db.server";
import { type Deps, liveDeps, NotConfigured } from "./deps.server";
import { publicOrigin } from "./env.server";
import { addIdeas } from "./ideas.server";
import { addLink, LinkInputError, linkById, processLink } from "./links.server";
import { PHOTO_PREFIX, storedPhoto } from "./photos.server";
import {
	currentWeek,
	nextRound,
	replaceIdea,
	WeekStateError,
	type WeekView,
} from "./week.server";

const log = getLogger("datenight.muse");

const respond = createErrorResponder({
	logger: log,
	mappers: [
		(err) =>
			err instanceof DateInputError
				? errorResponse(400, "bad_request", err.message)
				: null,
		(err) =>
			err instanceof WeekStateError
				? errorResponse(409, "conflict", err.message)
				: null,
		(err) =>
			err instanceof LinkInputError
				? errorResponse(400, "bad_request", err.message)
				: null,
		(err) =>
			err instanceof NotConfigured
				? errorResponse(503, "not_configured", err.message)
				: null,
	],
});

function tokenMatches(expected: string, given: string): boolean {
	const a = Buffer.from(expected);
	const b = Buffer.from(given);
	return a.length === b.length && timingSafeEqual(a, b);
}

const idSchema = z.string().uuid();

const bookingSchema = z.object({
	idea_id: idSchema,
	starts_at: z.string().datetime({ offset: true }),
	ends_at: z.string().datetime({ offset: true }).nullable().default(null),
	booking_ref: z.string().trim().max(200).default(""),
	booking_platform: z.string().trim().max(100).default(""),
	booking_email: z.string().trim().max(200).default(""),
	price_gbp: z.number().int().min(0).max(5000).nullable().default(null),
	dress_code: z.string().trim().max(100).default(""),
	notes: z.string().trim().max(1000).default(""),
});

const ratingSchema = z.object({
	happened: z.boolean(),
	rating: z.number().int().min(1).max(5).nullable().default(null),
	note: z.string().trim().max(1000).default(""),
});

const savedIdeaSchema = z.object({
	title: z.string().trim().min(1).max(200),
	venue: z.string().trim().min(1).max(200),
	category: z.enum(CATEGORIES),
	activity_kind: z.string().trim().min(1).max(100),
	price_gbp_for_two: z.number().int().min(0).max(5000).nullable().default(null),
	area: z.string().trim().max(100).default(""),
	address: z.string().trim().max(300).default(""),
	postcode: z.string().trim().max(12).default(""),
	url: z.string().trim().max(2000).default(""),
	booking_url: z.string().trim().max(2000).default(""),
	description: z.string().trim().max(600).default(""),
	ends_on: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable()
		.default(null),
});

/** Photo links Muse can fetch: a kept copy is served under /api/muse/photos. */
function museWeek(week: WeekView): WeekView {
	const origin = publicOrigin();
	return {
		...week,
		ideas: week.ideas.map((i) => ({
			...i,
			photos: i.photos.map((p) =>
				p.startsWith(PHOTO_PREFIX)
					? `${origin}/api/muse/photos/${p.slice(PHOTO_PREFIX.length)}`
					: p,
			),
		})),
	};
}

const linkSchema = z.object({
	url: z.string().trim().min(1).max(4000),
	note: z.string().trim().max(1000).default(""),
});

type Handler = (
	request: Request,
	deps: Deps,
	params: string[],
) => Promise<Response>;

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
	{
		method: "POST",
		pattern: /^links$/,
		handler: async (request, deps) => {
			if (!deps.settings.link) throw new NotConfigured("the link reader");
			const body = await readJson(request, linkSchema);
			const db = pool.getDb();
			const link = await addLink(db, {
				url: body.url,
				note: body.note,
				via: "muse",
			});
			// Reading takes a minute or two; Muse asks again with GET links/<id>.
			if (link.status === "pending")
				void processLink(db, deps, link.id).catch(() => {});
			return Response.json(link, { status: 202 });
		},
	},
	{
		method: "GET",
		pattern: /^links\/([^/]+)$/,
		handler: async (_r, _deps, [id = ""]) => {
			const linkId = idSchema.parse(id);
			const link = await linkById(pool.getDb(), linkId);
			if (!link) throw new ApiError(404, "not_found", "no link with that id");
			return Response.json(link);
		},
	},
	{
		method: "GET",
		pattern: /^photos\/([^/]+)$/,
		handler: async (_r, _deps, [id = ""]) => {
			const photoId = idSchema.parse(id);
			const photo = await storedPhoto(pool.getDb(), photoId);
			if (!photo) throw new ApiError(404, "not_found", "no photo with that id");
			return new Response(photo.bytes, {
				headers: {
					"content-type": photo.contentType,
					"cache-control": "private, max-age=31536000, immutable",
				},
			});
		},
	},
	{
		method: "GET",
		pattern: /^week$/,
		handler: async (_r, deps) =>
			Response.json(museWeek(await currentWeek(pool.getDb(), deps))),
	},
	{
		method: "POST",
		pattern: /^week\/next$/,
		handler: async (_r, deps) =>
			Response.json(museWeek(await nextRound(pool.getDb(), deps))),
	},
	{
		method: "POST",
		pattern: /^week\/replace$/,
		handler: async (request, deps) => {
			const body = await readJson(request, z.object({ idea_id: idSchema }));
			return Response.json(
				museWeek(await replaceIdea(pool.getDb(), deps, body.idea_id)),
			);
		},
	},
	{
		method: "POST",
		pattern: /^bookings$/,
		handler: async (request, deps) => {
			const b = await readJson(request, bookingSchema);
			const date = await book(pool.getDb(), deps, {
				ideaId: b.idea_id,
				startsAt: new Date(b.starts_at),
				endsAt: b.ends_at ? new Date(b.ends_at) : null,
				bookingRef: b.booking_ref,
				bookingPlatform: b.booking_platform,
				bookingEmail: b.booking_email,
				priceGbp: b.price_gbp,
				dressCode: b.dress_code,
				notes: b.notes,
			});
			return Response.json(date, { status: 201 });
		},
	},
	{
		method: "GET",
		pattern: /^dates\/awaiting-rating$/,
		handler: async (_r, deps) =>
			Response.json({ dates: await awaitingRating(pool.getDb(), deps) }),
	},
	{
		method: "POST",
		pattern: /^dates\/([^/]+)\/rating$/,
		handler: async (request, _deps, [id = ""]) => {
			const body = await readJson(request, ratingSchema);
			const dateId = idSchema.parse(id);
			return Response.json(await rate(pool.getDb(), dateId, body));
		},
	},
	{
		method: "POST",
		pattern: /^dates\/([^/]+)\/cancel$/,
		handler: async (_r, deps, [id = ""]) => {
			const dateId = idSchema.parse(id);
			return Response.json(await cancel(pool.getDb(), deps, dateId));
		},
	},
	{
		method: "GET",
		pattern: /^favourites$/,
		handler: async () =>
			Response.json({ dates: await favourites(pool.getDb()) }),
	},
	{
		method: "POST",
		pattern: /^ideas$/,
		handler: async (request, deps) => {
			const i = await readJson(request, savedIdeaSchema);
			const result = await addIdeas(
				pool.getDb(),
				deps,
				[
					{
						title: i.title,
						venue: i.venue,
						category: i.category,
						activityKind: i.activity_kind,
						priceGbp: i.price_gbp_for_two,
						area: i.area,
						address: i.address,
						postcode: i.postcode,
						url: i.url,
						bookingUrl: i.booking_url,
						description: i.description,
						endsOn: i.ends_on,
					},
				],
				"saved",
			);
			const outcome =
				result.repeats > 0
					? "repeat"
					: result.added > 0
						? "saved"
						: "already_known";
			return Response.json(
				{ outcome, id: result.ids[0] ?? null },
				{ status: result.added > 0 ? 201 : 200 },
			);
		},
	},
];

/** Answer one /api/muse/* request; `path` is the part after /api/muse/. */
export async function handleMuse(
	request: Request,
	path: string,
	deps: Deps = liveDeps(),
): Promise<Response> {
	try {
		const expected = deps.settings.museToken;
		if (!expected) throw new NotConfigured("the Muse token");
		const header = request.headers.get("authorization") ?? "";
		if (
			!header.startsWith("Bearer ") ||
			!tokenMatches(expected, header.slice(7))
		)
			throw new ApiError(401, "unauthorized", "missing or wrong bearer token");
		for (const route of routes) {
			const m = route.pattern.exec(path);
			if (!m) continue;
			if (route.method !== request.method) continue;
			return await route.handler(request, deps, m.slice(1));
		}
		throw new ApiError(
			404,
			"not_found",
			`no route ${request.method} /api/muse/${path}`,
		);
	} catch (err) {
		if (err instanceof z.ZodError)
			return errorResponse(400, "bad_request", "invalid id");
		return respond(err, request);
	}
}
