/**
 * Read-only sources: trips from the TripIt calendar feed, spending from
 * Actual Budget, evening photos from Immich, and postcode positions from
 * postcodes.io (free, no key, 100 postcodes a call).
 */
import type { Interval } from "#/domain/evening";
import type { PhotoDay, SpendEvidence } from "#/domain/history";
import { parseEvents } from "#/domain/ical";
import type { DateNightSettings } from "../env.server";

const TIMEOUT_MS = 60_000;

/** Every segment of every trip in the feed, as a time the Owner is away. */
export async function tripIntervals(feedUrl: string): Promise<Interval[]> {
	const res = await fetch(feedUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`TripIt feed answered ${res.status}`);
	return parseEvents(await res.text()).map((e) => ({
		start: e.start,
		end: e.end,
	}));
}

const SPEND_CATEGORIES = ["Eating Out", "Entertainment"];

interface ActualRow {
	date: string;
	amount: number;
	"payee.name": string | null;
	notes: string | null;
}

/** Spending on eating out and entertainment since a day. */
export async function spendSince(
	cfg: NonNullable<DateNightSettings["actual"]>,
	since: string,
): Promise<SpendEvidence[]> {
	const res = await fetch(`${cfg.url}/v1/budgets/${cfg.syncId}/run-query`, {
		method: "POST",
		headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
		body: JSON.stringify({
			ActualQLquery: {
				table: "transactions",
				options: { splits: "inline" },
				filter: {
					"category.name": { $oneof: SPEND_CATEGORIES },
					date: { $gte: since },
					amount: { $lt: 0 },
				},
				select: ["date", "amount", "payee.name", "notes"],
			},
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`Actual Budget answered ${res.status}`);
	const body = (await res.json()) as {
		data: ActualRow[] | { data: ActualRow[] };
	};
	const rows = Array.isArray(body.data) ? body.data : body.data.data;
	return rows.map((r) => ({
		on: r.date,
		payee: r["payee.name"] ?? "",
		notes: r.notes ?? "",
		amountPence: r.amount,
	}));
}

interface ImmichAsset {
	localDateTime?: string;
	fileCreatedAt?: string;
	exifInfo?: { city?: string | null } | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

/** Days with photos taken from 17:00 London time, and the cities in them. */
export async function eveningPhotoDays(
	cfg: NonNullable<DateNightSettings["immich"]>,
	since: string,
): Promise<PhotoDay[]> {
	const days = new Map<string, { count: number; places: Set<string> }>();
	for (let page = 1; page <= MAX_PAGES; page++) {
		const res = await fetch(`${cfg.url}/api/search/metadata`, {
			method: "POST",
			headers: {
				"x-api-key": cfg.apiKey,
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({
				takenAfter: `${since}T00:00:00.000Z`,
				page,
				size: PAGE_SIZE,
				withExif: true,
				type: "IMAGE",
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`Immich answered ${res.status}`);
		const body = (await res.json()) as {
			assets: { items: ImmichAsset[]; nextPage: string | null };
		};
		for (const asset of body.assets.items) {
			// localDateTime is the wall clock where the photo was taken, written as UTC.
			const local = asset.localDateTime ?? asset.fileCreatedAt;
			if (!local) continue;
			const hour = Number(local.slice(11, 13));
			if (hour < 17) continue;
			const on = local.slice(0, 10);
			let day = days.get(on);
			if (!day) {
				day = { count: 0, places: new Set() };
				days.set(on, day);
			}
			day.count++;
			const city = asset.exifInfo?.city;
			if (city) day.places.add(city);
		}
		if (!body.assets.nextPage) break;
	}
	return [...days.entries()].map(([on, d]) => ({
		on,
		count: d.count,
		places: [...d.places].slice(0, 3),
	}));
}

/** Positions for UK postcodes; unknown ones are left out. */
export async function geocodePostcodes(
	postcodes: readonly string[],
): Promise<Map<string, { lat: number; lon: number }>> {
	const out = new Map<string, { lat: number; lon: number }>();
	const unique = [
		...new Set(postcodes.map((p) => p.trim().toUpperCase()).filter(Boolean)),
	];
	for (let i = 0; i < unique.length; i += 100) {
		const res = await fetch("https://api.postcodes.io/postcodes", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ postcodes: unique.slice(i, i + 100) }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!res.ok) throw new Error(`postcodes.io answered ${res.status}`);
		const body = (await res.json()) as {
			result: {
				query: string;
				result: { latitude: number; longitude: number } | null;
			}[];
		};
		for (const r of body.result)
			if (r.result)
				out.set(r.query.toUpperCase(), {
					lat: r.result.latitude,
					lon: r.result.longitude,
				});
	}
	return out;
}
