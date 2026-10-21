import * as fs from "node:fs";
import * as path from "node:path";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { describe, onTestFinished, test, vi } from "vitest";
import {
	build,
	copyFixture,
	startDevServer,
	startPreviewServer,
} from "./helpers";
import type { RsbuildPlugin } from "@rsbuild/core";

/** Lets Rsbuild set `NODE_ENV` for its command, as when run from its CLI. */
function unsetNodeEnv() {
	vi.stubEnv("NODE_ENV", undefined);
	onTestFinished(() => {
		vi.unstubAllEnvs();
	});
}

describe("worker", () => {
	test("runs the Worker in workerd during dev", async ({ expect }) => {
		unsetNodeEnv();
		const url = await startDevServer(copyFixture("worker"));

		async function get(pathname: string): Promise<string> {
			return (await fetch(new URL(pathname, url))).text();
		}

		expect(await get("/")).toBe("Hello from rsbuild + workerd");
		expect(await get("/kv")).toBe("value");
		expect(await get("/node")).toBe("hello");
		expect(await get("/process")).toBe("object");
		expect(await get("/node-env")).toBe("development");
		expect(await get("/ssr")).toBe("true");
		expect(await get("/dynamic-import")).toBe("lazy chunk");
		expect(await get("/secret")).toBe("from-dev-vars");
	});

	test("applies the Worker's environment config once", async ({ expect }) => {
		const rspackConfig = vi.fn();
		await startDevServer(copyFixture("worker"), {
			environments: {
				cloudflare: {
					output: { externals: ["external-module"] },
					tools: { rspack: rspackConfig },
				},
			},
		});

		expect(rspackConfig).toHaveBeenCalledOnce();
		const [config] = rspackConfig.mock.calls[0] ?? [];
		expect(
			config.externals.filter(
				(external: unknown) => external === "external-module"
			)
		).toHaveLength(1);
	});

	test("reloads the Worker when its source changes", async ({ expect }) => {
		const root = copyFixture("worker");
		const url = await startDevServer(root);
		const lazyPath = path.join(root, "src", "lazy.ts");
		const dynamicImportUrl = new URL("/dynamic-import", url);

		expect(await (await fetch(dynamicImportUrl)).text()).toBe("lazy chunk");

		fs.writeFileSync(
			lazyPath,
			fs.readFileSync(lazyPath, "utf8").replace("lazy chunk", "updated chunk")
		);

		await vi.waitFor(
			async () => {
				expect(await (await fetch(dynamicImportUrl)).text()).toBe(
					"updated chunk"
				);
			},
			{ timeout: 10_000, interval: 100 }
		);
	});

	test("writes the Build Output Specification", async ({ expect }) => {
		const root = copyFixture("worker");
		const outputDir = path.join(root, ".cloudflare", "output", "v0");
		const workerDir = path.join(outputDir, "workers", "default");
		// Rsbuild copies `public/` into the Worker's output directory too.
		fs.mkdirSync(path.join(root, "public"));
		fs.writeFileSync(path.join(root, "public", "script.js"), "console.log();");
		// Output from a previous build.
		fs.mkdirSync(path.join(outputDir, "workers", "stale"), { recursive: true });
		fs.writeFileSync(
			path.join(outputDir, "workers", "stale", "worker.config.json"),
			"{}"
		);

		await build(root);

		const { rootConfig, workers } = await readBuildOutput(root);
		expect(rootConfig.buildContext).toMatchObject({ mode: "production" });
		expect(Object.keys(workers)).toEqual(["default"]);
		expect(workers.default?.config).toMatchObject({
			name: "rsbuild-worker",
			compatibilityFlags: ["nodejs_compat"],
			manifest: {
				mainModule: "index.js",
				modules: {
					"index.js": { type: "esm" },
					"index.js.map": { type: "sourcemap" },
				},
			},
		});
		expect(
			Object.keys(workers.default?.config.manifest?.modules ?? {})
		).toHaveLength(2);
		expect(
			fs.readFileSync(path.join(workerDir, "bundle", "index.js"), "utf8")
		).toContain("from rsbuild + workerd");
	});

	test("previews the Build Output in workerd", async ({ expect }) => {
		unsetNodeEnv();
		const root = copyFixture("worker");
		await build(root);
		const url = await startPreviewServer(root);

		async function get(pathname: string): Promise<string> {
			return (await fetch(new URL(pathname, url))).text();
		}

		expect(await get("/")).toBe("Hello from rsbuild + workerd");
		expect(await get("/kv")).toBe("value");
		expect(await get("/node")).toBe("hello");
		expect(await get("/node-env")).toBe("production");
		expect(await get("/ssr")).toBe("true");
		expect(await get("/dynamic-import")).toBe("lazy chunk");
		expect(await get("/secret")).toBe("from-dev-vars");
	});

	test("runs the Worker when a framework serves it in Node.js", async ({
		expect,
	}) => {
		const root = copyFixture("worker");
		// Like TanStack Start, which builds its server environment for Node.js and
		// serves the server bundle with `server.setup`: in dev, it handles some
		// requests before the Cloudflare plugin, with the bundle that
		// `loadBundle()` returns.
		const nodeServerPlugin: RsbuildPlugin = {
			name: "node-server",
			setup(api) {
				api.modifyRsbuildConfig((config, { mergeRsbuildConfig }) =>
					mergeRsbuildConfig(config, {
						environments: {
							cloudflare: { output: { target: "node", module: false } },
						},
						server: {
							setup: (context) => {
								if (context.action === "preview") {
									context.server.middlewares.use((_req, res) => {
										res.end("Hello from Node.js");
									});
									return;
								}
								const { environments } = context.server;
								context.server.middlewares.use(async (req, res, next) => {
									if (req.method !== "POST") {
										return next();
									}
									const bundle = await environments.cloudflare?.loadBundle<{
										default: { fetch: (request: Request) => Promise<Response> };
									}>("index");
									const response = await bundle?.default.fetch(
										new Request(new URL(req.url ?? "/", "http://localhost"), {
											method: "POST",
										})
									);
									res.end(`Framework: ${await response?.text()}`);
								});
							},
						},
					})
				);
			},
		};
		const devUrl = await startDevServer(root, { plugins: [nodeServerPlugin] });
		expect(await (await fetch(devUrl)).text()).toBe(
			"Hello from rsbuild + workerd"
		);
		expect(
			await (await fetch(new URL("/kv", devUrl), { method: "POST" })).text()
		).toBe("Framework: value");

		await build(root, { plugins: [nodeServerPlugin] });
		const previewUrl = await startPreviewServer(root, {
			plugins: [nodeServerPlugin],
		});
		expect(await (await fetch(previewUrl)).text()).toBe(
			"Hello from rsbuild + workerd"
		);
	});
});
