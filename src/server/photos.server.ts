/**
 * The photo crawl: read an Idea's pages, take the photo candidates
 * (src/domain/photos.ts), keep those that really are images, and copy the
 * ones whose links expire. Runs in the background, a few Ideas per scheduler
 * tick, so the pages it reads see a handful of requests at a time.
 */
import { getLogger } from "@viktorbarzin/log";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
	MAX_PHOTOS,
	needsCopy,
	photoCandidates,
	photoKey,
} from "#/domain/photos";
import { ideas, storedPhotos } from "./db/schema.server";
import type { Db } from "./db.server";
import type { Deps } from "./deps.server";

const log = getLogger("datenight.photos");

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const PAGE_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_COPY_BYTES = 3 * 1024 * 1024;
const MIN_IMAGE_BYTES = 15_000;
const MAX_PAGES = 4;

export const PHOTO_PREFIX = "/api/photos/";

async function readCapped(
	res: Response,
	cap: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
	const reader = res.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > cap) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

async function pageHtml(deps: Deps, url: string): Promise<string | null> {
	try {
		const res = await deps.fetch(url, {
			headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
			redirect: "follow",
			signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
		});
		if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
			await res.body?.cancel();
			return null;
		}
		const bytes = await readCapped(res, MAX_PAGE_BYTES);
		return bytes ? new TextDecoder().decode(bytes) : null;
	} catch {
		return null;
	}
}

function isPhoto(contentType: string, length: number | null): boolean {
	return (
		contentType.startsWith("image/") &&
		!contentType.includes("svg") &&
		(length === null || length >= MIN_IMAGE_BYTES)
	);
}

/** True when the link answers with a real, big enough image. */
async function looksLikePhoto(deps: Deps, url: string): Promise<boolean> {
	const headers = { "user-agent": UA, accept: "image/avif,image/webp,image/*" };
	try {
		const head = await deps.fetch(url, {
			method: "HEAD",
			headers,
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
		});
		const type = head.headers.get("content-type") ?? "";
		if (head.ok && type) {
			const len = head.headers.get("content-length");
			return isPhoto(type, len ? Number(len) : null);
		}
	} catch {
		// Some servers refuse HEAD; try a small GET below.
	}
	try {
		const res = await deps.fetch(url, {
			headers: { ...headers, range: "bytes=0-2047" },
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
		});
		await res.body?.cancel();
		if (!res.ok) return false;
		const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
		const len =
			total ?? (res.status === 200 ? res.headers.get("content-length") : null);
		return isPhoto(
			res.headers.get("content-type") ?? "",
			len ? Number(len) : null,
		);
	} catch {
		return false;
	}
}

/** Keep a copy of a photo whose link expires; returns its /api/photos/<id> link. */
async function copyPhoto(
	db: Db,
	deps: Deps,
	url: string,
): Promise<string | null> {
	try {
		const res = await deps.fetch(url, {
			headers: { "user-agent": UA, accept: "image/*" },
			signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
		});
		const type = res.headers.get("content-type") ?? "";
		if (!res.ok || !type.startsWith("image/") || type.includes("svg")) {
			await res.body?.cancel();
			return null;
		}
		const bytes = await readCapped(res, MAX_COPY_BYTES);
		if (!bytes || bytes.byteLength < 2_000) return null;
		const [row] = await db
			.insert(storedPhotos)
			.values({
				contentType: type.split(";")[0] ?? "image/jpeg",
				bytes,
				sourceUrl: url,
			})
			.returning({ id: storedPhotos.id });
		return row ? `${PHOTO_PREFIX}${row.id}` : null;
	} catch {
		return null;
	}
}

/**
 * Up to MAX_PHOTOS photos: copies of `copyFirst` (a post's own thumbnails),
 * then real images found on `pages`, in page order.
 */
export async function findPhotos(
	db: Db,
	deps: Deps,
	input: { pages: readonly string[]; copyFirst?: readonly string[] },
): Promise<string[]> {
	const out: string[] = [];
	for (const url of input.copyFirst ?? []) {
		if (out.length >= MAX_PHOTOS) break;
		const ref = await copyPhoto(db, deps, url);
		if (ref) out.push(ref);
	}
	const candidates: string[] = [];
	for (const page of [
		...new Set(input.pages.filter((p) => /^https?:\/\//.test(p))),
	].slice(0, MAX_PAGES)) {
		const html = await pageHtml(deps, page);
		if (!html) continue;
		for (const c of photoCandidates(html, page))
			if (!candidates.some((k) => photoKey(k) === photoKey(c)))
				candidates.push(c);
	}
	for (const url of candidates) {
		if (out.length >= MAX_PHOTOS) break;
		if (needsCopy(url)) {
			const ref = await copyPhoto(db, deps, url);
			if (ref) out.push(ref);
		} else if (await looksLikePhoto(deps, url)) {
			out.push(url);
		}
	}
	return out;
}

/** Find photos for the Ideas that have never been looked at; a few per call. */
export async function fillPhotos(
	db: Db,
	deps: Deps,
	limit: number,
): Promise<number> {
	const rows = await db
		.select({ id: ideas.id, url: ideas.url, bookingUrl: ideas.bookingUrl })
		.from(ideas)
		.where(and(isNull(ideas.photos), inArray(ideas.status, ["open", "booked"])))
		.orderBy(asc(ideas.createdAt))
		.limit(limit);
	for (const row of rows) {
		const photos = await findPhotos(db, deps, {
			pages: [row.url, row.bookingUrl],
		});
		await db.update(ideas).set({ photos }).where(eq(ideas.id, row.id));
		log.info("photos found", { idea_id: row.id, count: photos.length });
	}
	return rows.length;
}

export async function storedPhoto(db: Db, id: string) {
	const [row] = await db
		.select()
		.from(storedPhotos)
		.where(eq(storedPhotos.id, id));
	return row ?? null;
}
