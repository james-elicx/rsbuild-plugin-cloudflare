import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const fixtureRoot = path.join(
	import.meta.dirname,
	"../fixtures/tanstack-start"
);

test.describe("server rendering", () => {
	test("renders the page in workerd", async ({ request }) => {
		const response = await request.get("/");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("text/html");
		const html = await response.text();
		expect(html).toContain("<h3>Welcome Home!!!</h3>");
		// The loader's server function reads `navigator.userAgent` and a `vars`
		// binding through `cloudflare:workers`.
		expect(html).toContain("<p>Running in Cloudflare-Workers</p>");
		expect(html).toContain("<p>Hello from Cloudflare</p>");
		// The Worker and the client name the stylesheet that `__root.tsx` imports
		// with `?url` alike, so the page links it once.
		expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(1);
	});

	test("renders nested layouts", async ({ request }) => {
		const html = await (await request.get("/route-b")).text();
		expect(html).toContain("I&#x27;m a nested layout");
		expect(html).toContain("I&#x27;m B!");
	});

	test("streams deferred data", async ({ page }) => {
		await page.goto("/deferred");
		await expect(page.getByTestId("regular-person")).toContainText("John Doe");
		await expect(page.getByTestId("deferred-person")).toContainText(
			"Tanner Linsley"
		);
		await expect(page.getByTestId("deferred-stuff")).toHaveText(
			"Hello deferred!"
		);
	});

	test("responds with the not found page", async ({ request }) => {
		const response = await request.get("/this-route-does-not-exist");
		expect(response.status()).toBe(404);
		expect(await response.text()).toContain(
			"The page you are looking for does not exist."
		);
	});

	test("redirects", async ({ request }) => {
		const response = await request.get("/redirect", { maxRedirects: 0 });
		expect(response.status()).toBe(307);
		expect(response.headers()["location"]).toBe("/posts");
	});
});

test.describe("hydration and client-side navigation", () => {
	test("hydrates the page", async ({ page }) => {
		await page.goto("/deferred");
		await expect(page.getByText("Count: 0")).toBeVisible();
		await page.getByRole("button", { name: "Increment" }).click();
		await expect(page.getByText("Count: 1")).toBeVisible();
	});

	test("navigates between routes on the client", async ({ page }) => {
		await page.goto("/");
		await waitForHydration(page);
		// A full page load would reset this.
		await page.evaluate(() => {
			Object.assign(window, { notReloaded: true });
		});

		await page.getByRole("link", { name: "Pathless Layout" }).click();
		await expect(page).toHaveURL("/route-a");
		await expect(page.getByText("I'm A!")).toBeVisible();

		await page.getByRole("link", { name: "Go to route B" }).click();
		await expect(page).toHaveURL("/route-b");
		await expect(page.getByText("I'm B!")).toBeVisible();

		expect(await page.evaluate(() => "notReloaded" in window)).toBe(true);
	});

	test("calls server functions in workerd", async ({ page }) => {
		await page.goto("/route-a");
		await waitForHydration(page);

		// Navigating to `/` on the client runs its loader's server function
		// through a request to the Worker.
		const serverFnResponse = page.waitForResponse((response) =>
			new URL(response.url()).pathname.startsWith("/_serverFn/")
		);
		await page.getByRole("link", { name: "Home" }).click();
		expect((await serverFnResponse).status()).toBe(200);
		await expect(page.getByText("Running in Cloudflare-Workers")).toBeVisible();
		await expect(page.getByText("Hello from Cloudflare")).toBeVisible();
	});

	test("loads the page without errors", async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") {
				errors.push(message.text());
			}
		});
		const failedRequests: string[] = [];
		page.on("response", (response) => {
			if (!response.ok()) {
				failedRequests.push(`${response.status()} ${response.url()}`);
			}
		});

		await page.goto("/");
		await waitForHydration(page);

		expect(errors).toEqual([]);
		expect(failedRequests).toEqual([]);
	});
});

test.describe("server routes", () => {
	test("runs a server route", async ({ request }) => {
		const response = await request.get("/customScript.js");
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toBe("application/javascript");
		expect(await response.text()).toBe(
			'console.log("Hello from customScript.js!")'
		);
	});
});

test.describe("static assets", () => {
	test("serves files from public/", async ({ request }) => {
		for (const file of ["favicon.ico", "favicon-32x32.png"]) {
			const response = await request.get(`/${file}`);
			expect(response.status()).toBe(200);
			expect(await response.body()).toEqual(
				await fs.readFile(path.join(fixtureRoot, "public", file))
			);
		}
		const manifest = await request.get("/site.webmanifest");
		expect(manifest.status()).toBe(200);
		expect(await manifest.json()).toMatchObject({
			icons: [{ src: "/android-chrome-192x192.png" }, expect.anything()],
		});
	});

	test("serves the client's scripts and styles", async ({ page }) => {
		const assetResponses: Array<{ url: string; status: number }> = [];
		page.on("response", (response) => {
			const { pathname } = new URL(response.url());
			if (/^\/assets\/.+\.(js|css)$/.test(pathname)) {
				assetResponses.push({ url: pathname, status: response.status() });
			}
		});
		await page.goto("/");
		await waitForHydration(page);

		expect(assetResponses).toContainEqual({
			url: expect.stringMatching(/^\/assets\/js\/index\.\S*js$/),
			status: 200,
		});
		expect(assetResponses).toContainEqual({
			url: expect.stringMatching(/^\/assets\/css\/styles\/app\.\S*css$/),
			status: 200,
		});
		// Tailwind's styles apply.
		await expect(page.locator("body > div").first()).toHaveCSS(
			"display",
			"flex"
		);
	});
});

/**
 * Waits until the router has hydrated the page, after which TanStack Start
 * removes its `$_TSR` global.
 */
async function waitForHydration(page: Page) {
	await page.waitForFunction(() => !("$_TSR" in window));
}
