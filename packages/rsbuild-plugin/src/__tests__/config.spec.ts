import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "@rsbuild/core";
import { describe, test, vi } from "vitest";
import { build, copyFixture, startDevServer } from "./helpers";
import type { Logger } from "@rsbuild/core";

/**
 * Creates an Rsbuild logger that records warnings.
 *
 * @returns The logger and its `warn` mock.
 */
function createWarningLogger(): {
	logger: Logger;
	warn: ReturnType<typeof vi.fn>;
} {
	const logger = createLogger();
	const warn = vi.fn();
	logger.override({ warn });
	return { logger, warn };
}

/**
 * Copies the `worker` fixture with a Container-backed Durable Object.
 *
 * @returns The path of the copy.
 */
function copyContainersFixture(): string {
	const root = copyFixture("worker");
	fs.writeFileSync(path.join(root, "Dockerfile"), "FROM scratch\n");
	fs.writeFileSync(
		path.join(root, "src", "container.ts"),
		[
			'import { DurableObject } from "cloudflare:workers";',
			"export class AppContainer extends DurableObject {}",
			"export default { fetch: () => new Response() } satisfies ExportedHandler;",
		].join("\n")
	);
	fs.writeFileSync(
		path.join(root, "cloudflare.config.ts"),
		[
			'import { defineConfig, defineContainer, exports } from "cf/config";',
			'import * as entrypoint from "./src/container.ts" with { type: "cf-worker" };',
			"const container = defineContainer({",
			'	name: "app",',
			'	image: { dockerfile: "./Dockerfile" },',
			"});",
			"export default defineConfig({",
			"	worker: {",
			'		name: "containers",',
			"		entrypoint,",
			'		compatibilityDate: "2025-06-01",',
			"		exports: {",
			'			AppContainer: exports.durableObject({ storage: "sqlite", container }),',
			"		},",
			"	},",
			"	containers: [container],",
			"});",
		].join("\n")
	);
	return root;
}

describe("config", () => {
	test("rejects a Worker environment named `web`", async ({ expect }) => {
		await expect(
			build(copyFixture("worker"), {}, { rsbuildEnvironment: { name: "web" } })
		).rejects.toThrow('"web" is a reserved Rsbuild environment name');
	});

	test("warns in a build that Containers aren't supported", async ({
		expect,
	}) => {
		const root = copyContainersFixture();
		const { logger, warn } = createWarningLogger();

		await build(root, { customLogger: logger });

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Containers aren't supported")
		);
	});

	test("warns once in dev that Containers aren't supported", async ({
		expect,
	}) => {
		const root = copyContainersFixture();
		const { logger, warn } = createWarningLogger();
		const url = await startDevServer(root, { customLogger: logger });
		expect(await (await fetch(url)).text()).toBe("");

		const entrypoint = path.join(root, "src", "container.ts");
		fs.writeFileSync(
			entrypoint,
			fs
				.readFileSync(entrypoint, "utf8")
				.replace("new Response()", 'new Response("updated")')
		);
		await vi.waitFor(
			async () => {
				expect(await (await fetch(url)).text()).toBe("updated");
			},
			{ timeout: 10_000, interval: 100 }
		);

		expect(
			warn.mock.calls.filter(([message]) =>
				String(message).includes("Containers aren't supported")
			)
		).toHaveLength(1);
	});

	test.for([
		{ name: "without a public directory", hasPublicDir: false },
		{ name: "with an empty public directory", hasPublicDir: true },
	])(
		"fails a build with `assetsOnly`, an auxiliary Worker and no client, $name",
		async ({ hasPublicDir }, { expect }) => {
			const root = copyFixture("worker");
			if (hasPublicDir) {
				fs.mkdirSync(path.join(root, "public"));
			}

			await expect(
				build(
					root,
					{},
					{
						assetsOnly: true,
						auxiliaryWorkers: [
							{
								config: {
									name: "auxiliary",
									entrypoint: "./src/lazy.ts",
									compatibilityDate: "2025-06-01",
								},
							},
						],
					}
				)
			).rejects.toThrow(
				"If `assetsOnly` is set to `true`, the client environment must be built"
			);
		}
	);

	test.for([
		{ name: "without a public directory", hasPublicDir: false },
		{ name: "with an empty public directory", hasPublicDir: true },
	])(
		"fails a build with `assetsOnly` and no client, $name",
		async ({ hasPublicDir }, { expect }) => {
			const root = copyFixture("worker");
			if (hasPublicDir) {
				fs.mkdirSync(path.join(root, "public"));
			}

			await expect(build(root, {}, { assetsOnly: true })).rejects.toThrow(
				"If `assetsOnly` is set to `true`, the client environment must be built"
			);
		}
	);

	test("builds only the public assets with `assetsOnly` and no client entry", async ({
		expect,
	}) => {
		const root = copyFixture("worker");
		fs.mkdirSync(path.join(root, "public"));
		fs.writeFileSync(
			path.join(root, "public", "robots.txt"),
			"User-agent: *\n"
		);

		await build(root, {}, { assetsOnly: true });

		const workerDir = path.join(root, ".cloudflare/output/v0/workers/default");
		expect(fs.readdirSync(path.join(workerDir, "assets"))).toEqual([
			"robots.txt",
		]);
		expect(fs.existsSync(path.join(workerDir, "bundle"))).toBe(false);
	});

	test("builds only the public assets when every Worker is `devOnly`", async ({
		expect,
	}) => {
		const root = copyFixture("worker");
		fs.mkdirSync(path.join(root, "public"));
		fs.writeFileSync(
			path.join(root, "public", "robots.txt"),
			"User-agent: *\n"
		);

		await build(
			root,
			{},
			{
				assetsOnly: true,
				auxiliaryWorkers: [
					{
						config: {
							name: "auxiliary",
							entrypoint: "./src/lazy.ts",
							compatibilityDate: "2025-06-01",
						},
						devOnly: true,
					},
				],
			}
		);

		const workersDir = path.join(root, ".cloudflare/output/v0/workers");
		expect(fs.readdirSync(workersDir)).toEqual(["default"]);
		expect(fs.readdirSync(path.join(workersDir, "default", "assets"))).toEqual([
			"robots.txt",
		]);
	});

	test("warns about externals in Worker environments", async ({ expect }) => {
		const { logger, warn } = createWarningLogger();

		await build(copyFixture("worker"), {
			customLogger: logger,
			output: { externals: ["node:fs"] },
			environments: { cloudflare: { output: { externals: ["some-package"] } } },
		});

		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				'The "cloudflare" environment\'s `output.externals` option is incompatible'
			)
		);
	});

	test("doesn't warn about Node.js built-in externals", async ({ expect }) => {
		const { logger, warn } = createWarningLogger();

		await build(copyFixture("worker"), {
			customLogger: logger,
			output: { externals: ["node:fs", "path"] },
		});

		expect(warn).not.toHaveBeenCalled();
	});

	test("reads `_headers` from the public directory, unless it's disabled", async ({
		expect,
	}) => {
		const root = copyFixture("spa-with-api");
		fs.mkdirSync(path.join(root, "public"));
		fs.writeFileSync(
			path.join(root, "public", "_headers"),
			"/*\n  X-Custom: from-headers\n"
		);
		const config = { source: { entry: { index: "./src/index.ts" } } };
		const pluginConfig = {
			experimental: { headersAndRedirectsDevModeSupport: true },
		};

		const url = await startDevServer(root, config, pluginConfig);
		expect((await fetch(url)).headers.get("x-custom")).toBe("from-headers");

		const urlWithoutPublicDir = await startDevServer(
			root,
			{ ...config, server: { publicDir: false } },
			pluginConfig
		);
		expect(
			(await fetch(urlWithoutPublicDir)).headers.get("x-custom")
		).toBeNull();
	});
});
