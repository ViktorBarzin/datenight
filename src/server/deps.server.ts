/**
 * Everything the app's logic needs from outside the database, in one
 * object, so tests swap in fakes and the routes use the live services.
 */
import type { Interval } from "#/domain/evening";
import { type DateNightSettings, dateNightSettings } from "./env.server";
import {
	calendarEvents,
	deleteEvent,
	noticingTodos,
	putEvent,
} from "./integrations/caldav.server";
import { geocodePostcodes, tripIntervals } from "./integrations/sources.server";

export interface Deps {
	now: () => Date;
	settings: DateNightSettings;
	/** Events in the Date calendar between two instants. */
	busy: (from: Date, to: Date) => Promise<Interval[]>;
	/** Trip segments from TripIt. */
	trips: () => Promise<Interval[]>;
	/** Noticing File entries, as text. */
	hints: () => Promise<string[]>;
	putEvent: (uid: string, ics: string) => Promise<void>;
	deleteEvent: (uid: string) => Promise<void>;
	geocode: (
		postcodes: readonly string[],
	) => Promise<Map<string, { lat: number; lon: number }>>;
}

export class NotConfigured extends Error {
	constructor(what: string) {
		super(`${what} is not set up`);
		this.name = "NotConfigured";
	}
}

export function liveDeps(): Deps {
	const settings = dateNightSettings();
	const caldav = settings.caldav;
	return {
		now: () => new Date(),
		settings,
		busy: async (from, to) => {
			if (!caldav) return [];
			// An all-day event (a birthday, a reminder) does not make an evening busy.
			return (await calendarEvents(caldav, from, to)).filter((e) => !e.allDay);
		},
		trips: async () =>
			settings.tripitFeedUrl ? tripIntervals(settings.tripitFeedUrl) : [],
		hints: async () => {
			if (!caldav) return [];
			return (await noticingTodos(caldav)).map(
				(t) => `${t.summary} ${t.description}`,
			);
		},
		putEvent: async (uid, ics) => {
			if (!caldav) throw new NotConfigured("the calendar");
			await putEvent(caldav, uid, ics);
		},
		deleteEvent: async (uid) => {
			if (!caldav) throw new NotConfigured("the calendar");
			await deleteEvent(caldav, uid);
		},
		geocode: geocodePostcodes,
	};
}
