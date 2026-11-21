/**
 * Photos of an Idea, found on its listing and venue pages: the page's share
 * image, the images in its structured data, then large images in the page,
 * in that order. Logos, icons, trackers and tiny images stay out. The server
 * checks each candidate is a real image before keeping it.
 */

export const MAX_PHOTOS = 8;
/** Candidates the server checks, so a few broken ones still leave eight. */
export const MAX_CANDIDATES = 16;

const SKIP_WORDS =
	/(^|[/_.-])(logos?|icons?|sprites?|favicon|avatars?|placeholder|pixel|badges?|spinner|loader|payment|visa|mastercard|paypal|flags?|arrows?|tracking|blank|transparent|emoji)([/_.@0-9-]|$)/i;
const SKIP_HOSTS =
	/(^|\.)(facebook\.com|google-analytics\.com|doubleclick\.net|googletagmanager\.com|bing\.com|tiktok\.com\/i18n)$/i;
const SKIP_EXT = /\.(svg|gif|ico)(\?|#|$)/i;
const MIN_SIDE = 300;

function attr(tag: string, name: string): string | null {
	const m = new RegExp(
		`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
		"i",
	).exec(tag);
	if (!m) return null;
	return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function decode(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&#38;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#x2F;/gi, "/");
}

/** The largest entry of a srcset: by width (w) or density (x). */
function largestFromSrcset(srcset: string): string | null {
	let best: { url: string; size: number } | null = null;
	for (const part of srcset.split(",")) {
		const [url, descriptor = "1x"] = part.trim().split(/\s+/);
		if (!url) continue;
		const size =
			Number.parseFloat(descriptor) * (descriptor.endsWith("w") ? 1 : 1000);
		if (!best || size > best.size)
			best = { url, size: Number.isFinite(size) ? size : 0 };
	}
	return best?.url ?? null;
}

function jsonLdImages(value: unknown, out: string[], depth = 0): void {
	if (depth > 6 || value === null || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const v of value) jsonLdImages(v, out, depth + 1);
		return;
	}
	for (const [key, v] of Object.entries(value)) {
		if (key === "image" || key === "photo" || key === "contentUrl") {
			for (const item of Array.isArray(v) ? v : [v]) {
				if (typeof item === "string") out.push(item);
				else if (item && typeof item === "object") {
					const url =
						(item as Record<string, unknown>).url ??
						(item as Record<string, unknown>).contentUrl;
					if (typeof url === "string") out.push(url);
				}
			}
		} else if (key !== "logo" && typeof v === "object") {
			jsonLdImages(v, out, depth + 1);
		}
	}
}

function usable(url: string): boolean {
	if (!/^https?:\/\//i.test(url)) return false;
	if (SKIP_EXT.test(url)) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (SKIP_HOSTS.test(parsed.hostname)) return false;
	if (SKIP_WORDS.test(parsed.pathname)) return false;
	return true;
}

/** Photo links on one page, best first, at most MAX_CANDIDATES. */
export function photoCandidates(html: string, pageUrl: string): string[] {
	const raw: string[] = [];

	for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = m[0];
		const key = (
			attr(tag, "property") ??
			attr(tag, "name") ??
			""
		).toLowerCase();
		if (
			[
				"og:image",
				"og:image:secure_url",
				"og:image:url",
				"twitter:image",
				"twitter:image:src",
			].includes(key)
		) {
			const content = attr(tag, "content");
			if (content) raw.push(content);
		}
	}

	for (const m of html.matchAll(
		/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	)) {
		try {
			jsonLdImages(JSON.parse(m[1] ?? ""), raw);
		} catch {
			// Broken structured data is common; skip it.
		}
	}

	for (const m of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
		const tag = m[0];
		const width = Number.parseInt(attr(tag, "width") ?? "", 10);
		const height = Number.parseInt(attr(tag, "height") ?? "", 10);
		if (
			(Number.isFinite(width) && width < MIN_SIDE) ||
			(Number.isFinite(height) && height < MIN_SIDE)
		)
			continue;
		const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
		const fromSet = srcset ? largestFromSrcset(srcset) : null;
		const src =
			fromSet ??
			attr(tag, "data-src") ??
			attr(tag, "data-lazy-src") ??
			attr(tag, "data-original") ??
			attr(tag, "src");
		if (src) raw.push(src);
	}

	const out: string[] = [];
	const seen = new Set<string>();
	for (const candidate of raw) {
		let absolute: string;
		try {
			absolute = new URL(decode(candidate), pageUrl).toString();
		} catch {
			continue;
		}
		if (!usable(absolute)) continue;
		const key = absolute.replace(/[?#].*$/, "");
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(absolute);
		if (out.length >= MAX_CANDIDATES) break;
	}
	return out;
}

const EXPIRING_HOSTS =
	/(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn\.com|tiktokcdn-eu\.com|tiktokcdn-us\.com|ttwstatic\.com)$/i;

/** Image links that expire within days; the app keeps its own copy of these. */
export function needsCopy(url: string): boolean {
	try {
		return EXPIRING_HOSTS.test(new URL(url).hostname);
	} catch {
		return false;
	}
}
