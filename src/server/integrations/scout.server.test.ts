import { describe, expect, test } from "bun:test";

import { parseScoutIdeas } from "./scout.server";

describe("parseScoutIdeas", () => {
	test("keeps valid ideas, fills defaults, drops invalid ones", () => {
		const { ideas, dropped } = parseScoutIdeas({
			ideas: [
				{
					title: "Candlelit flamenco",
					venue: "Sadler's Wells",
					category: "shows",
					activity_kind: "flamenco show",
					price_gbp_for_two: 70,
					url: "https://example.com/flamenco",
				},
				{ title: "No category", venue: "X", activity_kind: "y" },
				{
					title: "Bad link",
					venue: "X",
					category: "food",
					activity_kind: "dinner",
					url: "javascript:alert(1)",
				},
				"not an object",
			],
		});
		expect(dropped).toBe(3);
		expect(ideas).toEqual([
			{
				title: "Candlelit flamenco",
				venue: "Sadler's Wells",
				address: "",
				area: "",
				postcode: "",
				category: "shows",
				activity_kind: "flamenco show",
				price_gbp_for_two: 70,
				url: "https://example.com/flamenco",
				booking_url: "",
				description: "",
				why: "",
				ends_on: null,
			},
		]);
	});

	test("an answer without an ideas list throws", () => {
		expect(() => parseScoutIdeas({ songs: [] })).toThrow();
	});
});
