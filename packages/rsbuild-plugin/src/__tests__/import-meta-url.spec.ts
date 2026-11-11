import * as fs from "node:fs";
import * as path from "node:path";
import {
	getWorkerAssetsDir,
	getWorkerBundleDir,
} from "@cloudflare/build-output-utils";
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

	test("copies the assets that the prerender Worker imports to the client's build output", async ({
		expect,
	}) => {
		const root = copyFixture("import-meta-url");
		fs.copyFileSync(
			path.join(root, "src/logo.svg"),
			path.join(root, "src/prerender-logo.svg")
		);
		fs.writeFileSync(
			path.join(root, "src/prerender.ts"),
			fs
				.readFileSync(path.join(root, "src/index.ts"), "utf8")
				.replace("./logo.svg", "./prerender-logo.svg")
		);
		await build(
			root,
			{},
			{
				prerenderWorker: {
					config: ({ entryWorkerConfig }) => ({
						...entryWorkerConfig,
						name: "prerender",
						entrypoint: "./src/prerender.ts",
					}),
				},
			}
		);

		const listFiles = (dir: string) =>
			fs.readdirSync(dir, { recursive: true, encoding: "utf8" });
		const assets = listFiles(getWorkerAssetsDir(root));
		expect(
			assets.filter((file) => /^logo.*\.svg$/.test(path.basename(file)))
		).toHaveLength(1);
		expect(
			assets.filter((file) => /prerender-logo.*\.svg$/.test(file))
		).toHaveLength(1);
		// As in the Vite plugin, the entry Worker's assets are moved, but the
		// prerender Worker keeps its own.
		expect(
			listFiles(getWorkerBundleDir(root)).filter((file) =>
				file.endsWith(".svg")
			)
		).toHaveLength(0);
		expect(
			listFiles(getWorkerBundleDir(root, "prerender")).filter((file) =>
				/prerender-logo.*\.svg$/.test(file)
			)
		).toHaveLength(1);
	});
});
