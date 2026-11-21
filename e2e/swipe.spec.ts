import { expect, test } from "@playwright/test";

import { app } from "../src/app.config";
import { addUser, collectErrors, saveIdeaVia, signedInPage } from "./fixtures";

test("dragging a card right likes it and the Liked tab shows it; the Pass button passes", async ({
	browser,
}) => {
	await addUser("swiper@example.com", [app.usersGroup]);
	const page = await signedInPage(browser, "swiper@example.com", "/ideas");
	const errors = collectErrors(page);
	await saveIdeaVia(page, "swipe test one");
	await saveIdeaVia(page, "swipe test two");
	await expect(page.getByTestId("ideas")).toContainText("swipe test two");

	await page.getByRole("link", { name: "Swipe" }).click();
	const card = page.getByTestId("card");
	await expect(card).toBeVisible();
	const liked = (await card.getAttribute("aria-label")) ?? "";

	const box = await card.boundingBox();
	if (!box) throw new Error("no card box");
	const y = box.y + box.height / 3;
	await page.mouse.move(box.x + box.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 5 });
	await page.mouse.move(box.x + box.width / 2 + 240, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.getByTestId("card")).not.toHaveAttribute(
		"aria-label",
		liked,
	);

	const passed =
		(await page.getByTestId("card").getAttribute("aria-label")) ?? "";
	await page.getByRole("button", { name: "Pass" }).click();
	await expect(
		page.getByTestId("card").or(page.getByText("You have seen everything.")),
	).toBeVisible();

	await page.getByRole("link", { name: "Ideas" }).click();
	await page.getByRole("tab", { name: "Liked" }).click();
	await expect(page.getByTestId("ideas")).toContainText(liked);
	await page.getByRole("tab", { name: "Not for us" }).click();
	await expect(page.getByTestId("ideas")).toContainText(passed);
	expect(errors).toEqual([]);
});
