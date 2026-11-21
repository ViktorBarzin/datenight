import { describe, expect, test } from "bun:test";

import { MAX_PHOTOS, needsCopy, photoCandidates, photoKey } from "./photos";

const page = `<!doctype html><html><head>
<meta property="og:image" content="https://cdn.example.com/hero.jpg?w=1200">
<meta name="twitter:image" content="https://cdn.example.com/hero.jpg?w=600">
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">{"@type":"Restaurant","image":["https://cdn.example.com/room.jpg",{"@type":"ImageObject","url":"https://cdn.example.com/dish.webp"}],"logo":"https://cdn.example.com/logo.png"}</script>
</head><body>
<img src="/img/logo-white.svg" alt="logo">
<img src="/media/cocktails.jpg" width="1200" height="800">
<img src="/media/tiny.jpg" width="40" height="40">
<img data-src="https://cdn.example.com/lazy.jpg" src="data:image/gif;base64,R0lGOD">
<img srcset="/media/stage-400.jpg 400w, /media/stage-1600.jpg 1600w" src="/media/stage-400.jpg">
<picture><source srcset="/media/bar.avif 1x, /media/bar@2x.avif 2x"><img src="/media/bar.jpg"></picture>
<img src="https://www.facebook.com/tr?id=1&ev=PageView">
<img src="/assets/payment-visa.png">
<img src="/media/spinner.gif">
</body></html>`;

describe("photoCandidates", () => {
	const found = photoCandidates(
		page,
		"https://venue.example.com/whats-on/show",
	);

	test("puts the page's own share image first, once", () => {
		expect(found[0]).toBe("https://cdn.example.com/hero.jpg?w=1200");
		expect(found.filter((u) => u.includes("hero.jpg"))).toHaveLength(1);
	});

	test("reads structured data images but not the logo", () => {
		expect(found).toContain("https://cdn.example.com/room.jpg");
		expect(found).toContain("https://cdn.example.com/dish.webp");
		expect(found.some((u) => u.includes("logo"))).toBe(false);
	});

	test("resolves relative images, lazy sources and the largest srcset entry", () => {
		expect(found).toContain("https://venue.example.com/media/cocktails.jpg");
		expect(found).toContain("https://cdn.example.com/lazy.jpg");
		expect(found).toContain("https://venue.example.com/media/stage-1600.jpg");
		expect(found).not.toContain(
			"https://venue.example.com/media/stage-400.jpg",
		);
		expect(found).toContain("https://venue.example.com/media/bar@2x.avif");
	});

	test("skips icons, tiny images, trackers, payment marks, gifs and data URLs", () => {
		for (const bad of [
			"favicon",
			"tiny.jpg",
			"facebook.com/tr",
			"payment",
			"spinner",
			"data:",
		])
			expect(found.some((u) => u.includes(bad))).toBe(false);
	});

	test("a word like flagship in a real photo's name does not drop it", () => {
		const html =
			'<img src="/media/flagship-restaurant.jpg"><img src="/img/site-logo.png">';
		expect(photoCandidates(html, "https://v.example")).toEqual([
			"https://v.example/media/flagship-restaurant.jpg",
		]);
	});

	test("the same photo in several sizes counts once", () => {
		const html = `<meta property="og:image" content="https://s.example/uploads/Elf-Taste-Film-optimised.png">
<img src="https://s.example/uploads/Elf-Taste-Film.png">
<img src="https://media.example/images/105558937/image.jpg">
<img src="https://media.example/images/105558937/1920/1080/image.webp">
<img src="https://cdn.example/photo-1200x800.jpg"><img src="https://cdn.example/photo-scaled.jpg">`;
		expect(photoCandidates(html, "https://p.example")).toEqual([
			"https://s.example/uploads/Elf-Taste-Film-optimised.png",
			"https://media.example/images/105558937/image.jpg",
			"https://cdn.example/photo-1200x800.jpg",
		]);
	});

	test("an author's headshot or a profile picture stays out", () => {
		const html = `<img src="/u/Scarlett-optimised.png" class="author-image"><img src="/u/me.jpg" alt="Profile photo of Sam"><img src="/u/room.jpg" alt="The dining room">`;
		expect(photoCandidates(html, "https://p.example")).toEqual([
			"https://p.example/u/room.jpg",
		]);
	});

	test("an empty or broken page gives nothing", () => {
		expect(photoCandidates("", "https://x.example")).toEqual([]);
		expect(
			photoCandidates(
				"<script type='application/ld+json'>{not json</script>",
				"https://x.example",
			),
		).toEqual([]);
	});
});

describe("photoKey", () => {
	test("ignores size, format and resizer parts of a link", () => {
		expect(photoKey("https://a.example/x/Elf-optimised.png?w=1")).toBe(
			photoKey("https://a.example/x/Elf.jpg"),
		);
		expect(photoKey("https://a.example/i/1/1920/1080/image.webp")).toBe(
			photoKey("https://a.example/i/1/image.jpg"),
		);
		expect(photoKey("https://a.example/room.jpg")).not.toBe(
			photoKey("https://a.example/bar.jpg"),
		);
	});
});

describe("needsCopy", () => {
	test("Instagram and TikTok image links expire, so the app keeps a copy", () => {
		expect(
			needsCopy("https://scontent-cdg4-1.cdninstagram.com/v/t51/x.jpg?oe=1"),
		).toBe(true);
		expect(needsCopy("https://p16-common-sign.tiktokcdn-eu.com/x.image")).toBe(
			true,
		);
		expect(needsCopy("https://scontent.xx.fbcdn.net/x.jpg")).toBe(true);
		expect(needsCopy("https://cdn.example.com/hero.jpg")).toBe(false);
	});
});

test("an idea shows at most eight photos", () => {
	expect(MAX_PHOTOS).toBe(8);
});
