import { describe, test } from "vitest";
import { copyFixture, startDevServer } from "./helpers";

describe("no-default-export", () => {
	test("gives the Worker an empty default export, as in the Vite plugin", async ({
		expect,
	}) => {
		const url = await startDevServer(copyFixture("no-default-export"));

		// workerd runs the Worker, which has no `fetch()` handler.
		const response = await fetch(url);
		expect(response.status).toBe(500);
		expect(await response.text()).toContain(
			"Handler does not export a fetch() function."
		);
	});
});
