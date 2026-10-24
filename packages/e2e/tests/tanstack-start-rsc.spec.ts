import { expect, test } from "@playwright/test";
import { collectPageErrors, waitForHydration } from "./helpers";

test.describe("React Server Components", () => {
	test("renders server components in workerd", async ({ request }) => {
		const response = await request.get("/rsc");
		expect(response.status()).toBe(200);
		// Without the comments that React separates text nodes with.
		const html = (await response.text()).replaceAll("<!-- -->", "");
		// The server component reads `navigator.userAgent` and a `vars` binding
		// through `cloudflare:workers`.
		expect(html).toContain("<h3>Hello from RSC</h3>");
		expect(html).toContain(
			"Rendered in Cloudflare-Workers: Hello from Cloudflare"
		);
		expect(html).toContain("<h3>Server-rendered header</h3>");
		// Client components are server-rendered too: the one that the server
		// component imports, and the one that the page passes to the composite
		// component's slot.
		expect(html).toMatch(/<button[^>]*>Server component&#x27;s counter: 0/);
		expect(html).toMatch(/<button[^>]*>Slot&#x27;s counter: 0/);
	});

	test("hydrates the server components' client components", async ({
		page,
	}) => {
		const { errors, failedRequests } = collectPageErrors(page);
		await page.goto("/rsc");
		await waitForHydration(page);

		for (const label of ["Server component's counter", "Slot's counter"]) {
			const counter = page.getByRole("button", { name: label });
			await counter.click();
			await expect(counter).toHaveText(`${label}: 1`);
		}
		expect(errors).toEqual([]);
		expect(failedRequests).toEqual([]);
	});

	test("renders server components after client-side navigation", async ({
		page,
	}) => {
		await page.goto("/");
		await waitForHydration(page);

		// The loader's server functions render the server components in the
		// Worker.
		const serverFnResponse = page.waitForResponse((response) =>
			new URL(response.url()).pathname.startsWith("/_serverFn/")
		);
		await page.getByRole("link", { name: "Server Components" }).click();
		expect((await serverFnResponse).status()).toBe(200);
		await expect(page).toHaveURL("/rsc");
		await expect(
			page.getByText("Rendered in Cloudflare-Workers: Hello from Cloudflare")
		).toBeVisible();
		const counter = page.getByRole("button", {
			name: "Server component's counter",
		});
		await counter.click();
		await expect(counter).toHaveText("Server component's counter: 1");
	});
});
