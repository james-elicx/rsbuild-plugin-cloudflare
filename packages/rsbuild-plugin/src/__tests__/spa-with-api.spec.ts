import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "vitest";
import {
	build,
	copyFixture,
	startDevServer,
	startPreviewServer,
} from "./helpers";
import type { RsbuildConfig, RsbuildPlugin } from "@rsbuild/core";

// Mirrors the fixture's `rsbuild.config.ts`.
const config: RsbuildConfig = {
	source: { entry: { index: "./src/index.ts" } },
};

describe("spa-with-api", () => {
	test("serves client assets, the API, and the SPA fallback during dev", async ({
		expect,
	}) => {
		const url = await startDevServer(copyFixture("spa-with-api"), config);

		const index = await fetch(url);
		expect(index.headers.get("x-from-worker")).toBeNull();
		expect(await index.text()).toContain('src="/static/js/index.js"');

		const script = await fetch(new URL("/static/js/index.js", url));
		expect(script.headers.get("content-type")).toContain("javascript");
		expect(await script.text()).toContain("/api/hello");

		const api = await fetch(new URL("/api/hello", url));
		expect(await api.json()).toEqual({ name: "Cloudflare" });

		// Without `nodejs_compat`, `process.env` is an empty object.
		const env = await fetch(new URL("/api/env", url));
		expect(await env.text()).toBe("undefined");

		// Unmatched routes reach the Worker, which serves `index.html` through
		// its assets binding.
		const fallback = await fetch(new URL("/some/route", url));
		expect(fallback.headers.get("x-from-worker")).toBe("true");
		expect(await fallback.text()).toContain('src="/static/js/index.js"');
	});

	test("writes the client to the Worker's assets directory", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		await build(root, config);

		const workerDir = path.join(
			root,
			".cloudflare",
			"output",
			"v0",
			"workers",
			"default"
		);

		expect(fs.existsSync(path.join(workerDir, "assets", "index.html"))).toBe(
			true
		);
		expect(fs.existsSync(path.join(workerDir, "bundle", "index.js"))).toBe(
			true
		);
		expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(workerDir, "worker.config.json"), "utf8")
			)
		).toMatchObject({
			assets: { notFoundHandling: "single-page-application" },
			env: { ASSETS: { type: "assets" } },
		});
	});

	test("links the client's stylesheet from the Worker whatever the minify setting", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		await build(root, {
			...config,
			mode: "production",
			output: { minify: false },
		});
		const url = await startPreviewServer(root);

		const stylesheet = await (
			await fetch(new URL("/api/stylesheet", url))
		).text();
		expect(stylesheet).toMatch(/^\/static\/css\/.+\.css$/);
		// The Worker's copy of the stylesheet isn't added to the client's.
		const cssDir = path.join(
			root,
			".cloudflare/output/v0/workers/default/assets/static/css"
		);
		expect(fs.readdirSync(cssDir)).toEqual([path.basename(stylesheet)]);
	});

	test("builds and serves the client from Rsbuild's default entry when `index.html` exists", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		fs.writeFileSync(
			path.join(root, "index.html"),
			"<!doctype html><html><body></body></html>\n"
		);

		const url = await startDevServer(root);
		expect(await (await fetch(url)).text()).toContain(
			'src="/static/js/index.js"'
		);

		await build(root);
		expect(
			fs.existsSync(
				path.join(
					root,
					".cloudflare/output/v0/workers/default/assets/index.html"
				)
			)
		).toBe(true);
	});

	test("doesn't build a client from Rsbuild's default entry without `index.html`", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");

		await build(root);

		// The assets directory only has the stylesheet that the Worker imports.
		const assetsDir = path.join(
			root,
			".cloudflare/output/v0/workers/default/assets"
		);
		expect(fs.existsSync(path.join(assetsDir, "index.html"))).toBe(false);
		expect(fs.existsSync(path.join(assetsDir, "static", "js"))).toBe(false);
	});

	test("previews the Build Output with assets served by workerd", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		await build(root, config);
		const url = await startPreviewServer(root);

		const index = await fetch(url);
		expect(index.headers.get("x-from-worker")).toBeNull();
		const html = await index.text();
		const scriptPath = html.match(/src="(\/static\/js\/index[^"]*\.js)"/)?.[1];
		expect(scriptPath).toBeDefined();

		const script = await fetch(new URL(scriptPath ?? "", url));
		expect(script.headers.get("x-from-worker")).toBeNull();
		expect(await script.text()).toContain("/api/hello");

		const api = await fetch(new URL("/api/hello", url));
		expect(await api.json()).toEqual({ name: "Cloudflare" });

		const fallback = await fetch(new URL("/some/route", url));
		expect(fallback.headers.get("x-from-worker")).toBe("true");
		expect(await fallback.text()).toBe(html);
	});

	test("doesn't build an `assetsOnly` Worker's environment as a client", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		let environmentNames: string[] = [];
		const recordEnvironments: RsbuildPlugin = {
			name: "record-environments",
			setup(api) {
				api.onBeforeBuild(({ environments }) => {
					environmentNames = Object.keys(environments);
				});
			},
		};

		await build(
			root,
			{
				...config,
				environments: { cloudflare: { output: { minify: true } } },
				plugins: [recordEnvironments],
			},
			{ assetsOnly: true }
		);

		expect(environmentNames).toEqual(["web"]);
		const workerDir = path.join(root, ".cloudflare/output/v0/workers/default");
		expect(fs.existsSync(path.join(workerDir, "assets", "index.html"))).toBe(
			true
		);
		expect(fs.existsSync(path.join(workerDir, "bundle"))).toBe(false);
	});
});
