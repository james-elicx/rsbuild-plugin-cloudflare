import { describe, test } from "vitest";
import {
	build,
	copyFixture,
	startDevServer,
	startPreviewServer,
} from "./helpers";

// `import.meta.url` is undefined in workerd, so the Worker would fail to start
// if Rspack resolved the asset's URL against it.
describe("import-meta-url", () => {
	test("gives assets imported with `new URL(..., import.meta.url)` URLs in dev", async ({
		expect,
	}) => {
		const url = await startDevServer(copyFixture("import-meta-url"));

		const response = await fetch(url);
		expect(response.status).toBe(200);
		expect(await response.text()).toMatch(/^\/.*logo.*\.svg$/);
	});

	test("gives assets imported with `new URL(..., import.meta.url)` URLs in preview", async ({
		expect,
	}) => {
		const root = copyFixture("import-meta-url");
		await build(root);
		const url = await startPreviewServer(root);

		const response = await fetch(url);
		expect(response.status).toBe(200);
		const assetPath = await response.text();
		expect(assetPath).toMatch(/^\/.*logo.*\.svg$/);
		// The asset is moved to the client's build output, so it's served.
		expect((await fetch(new URL(assetPath, url))).status).toBe(200);
	});
});
