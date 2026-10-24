import type { Page } from "@playwright/test";

/**
 * Waits until the router has hydrated the page, after which TanStack Start
 * removes its `$_TSR` global.
 *
 * @param page The page.
 */
export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForFunction(() => !("$_TSR" in window));
}

/**
 * Collects the page's errors and failed requests.
 *
 * @param page The page.
 * @returns The errors and failed requests, as they happen.
 */
export function collectPageErrors(page: Page): {
	errors: string[];
	failedRequests: string[];
} {
	const errors: string[] = [];
	const failedRequests: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") {
			errors.push(message.text());
		}
	});
	page.on("response", (response) => {
		if (!response.ok()) {
			failedRequests.push(`${response.status()} ${response.url()}`);
		}
	});
	return { errors, failedRequests };
}
