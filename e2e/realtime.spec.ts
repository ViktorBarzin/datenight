import { expect, test } from "@playwright/test";

import { app } from "../src/app.config";
import { addUser, call, saveIdeaVia, signedInPage } from "./fixtures";

test("an idea saved in one tab shows in another within 2 s, without a reload", async ({
	browser,
}) => {
	await addUser("twotabs@example.com", [app.usersGroup]);
	const a = await signedInPage(browser, "twotabs@example.com", "/ideas");
	const b = await signedInPage(browser, "twotabs@example.com", "/ideas");
	await expect(a.getByTestId("ideas")).toBeVisible();
	await expect(b.getByTestId("ideas")).toBeVisible();
	// Let B's EventSource open before the write.
	await b.waitForTimeout(500);
	let reloaded = false;
	b.on("framenavigated", () => {
		reloaded = true;
	});

	await saveIdeaVia(a, "from tab A");
	await expect(b.getByTestId("ideas")).toContainText("from tab A", {
		timeout: 2_000,
	});
	expect(reloaded).toBe(false);
});

test("after the LISTEN connection is killed, the other tab resyncs", async ({
	browser,
}) => {
	await addUser("resync@example.com", [app.usersGroup]);
	const b = await signedInPage(browser, "resync@example.com", "/ideas");
	await expect(b.getByTestId("ideas")).toBeVisible();
	await b.waitForTimeout(500);

	// A write that sends no NOTIFY: only a resync can bring it to the page.
	await call("/silent-idea", {
		username: "resync@example.com",
		title: "written while nobody listened",
	});
	await b.waitForTimeout(500);
	await expect(b.getByTestId("ideas")).not.toContainText(
		"written while nobody listened",
	);

	await call("/kill-listen");
	await expect(b.getByTestId("ideas")).toContainText(
		"written while nobody listened",
		{ timeout: 15_000 },
	);
});
