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

describe("config", () => {
	test("warns in a build that Containers aren't supported", async ({
		expect,
	}) => {
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
		const { logger, warn } = createWarningLogger();

		await build(root, { customLogger: logger });

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Containers aren't supported")
		);
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
