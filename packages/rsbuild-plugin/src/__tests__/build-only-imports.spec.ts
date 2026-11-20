import assert from "node:assert";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { test } from "vitest";
import { copyFixture } from "./helpers";

// As upstream's `build-only-imports.spec.ts`: a build only bundles the Workers,
// so it mustn't pay the cost of loading Miniflare.
test("builds a Worker with additional modules without loading Miniflare", async ({
	expect,
}) => {
	const root = copyFixture("additional-modules");
	const script = `
		import { registerHooks } from "node:module";
		registerHooks({
			resolve(specifier, context, nextResolve) {
				if (specifier === "miniflare" || specifier.startsWith("miniflare/")) {
					throw new Error("Unexpected Miniflare import: " + specifier);
				}
				return nextResolve(specifier, context);
			},
		});
		const { createRsbuild } = await import("@rsbuild/core");
		const { cloudflare } = await import("rsbuild-plugin-cloudflare");
		const rsbuild = await createRsbuild({
			cwd: process.argv[1],
			config: {
				logLevel: "error",
				plugins: [cloudflare({ types: { includeRuntime: false } })],
			},
		});
		const { close } = await rsbuild.build();
		await close();
	`;
	await promisify(execFile)(
		process.execPath,
		["--input-type=module", "--eval", script, root],
		{ cwd: path.resolve(import.meta.dirname, "../.."), timeout: 30_000 }
	);

	const { workers } = await readBuildOutput(root);
	const { bundleDir, config } = workers.default;
	const textModule = Object.entries(config.manifest?.modules ?? {}).find(
		([, module]) => module.type === "text"
	);
	assert(bundleDir && textModule, "Expected the build to emit a text module");
	expect(fs.readFileSync(path.join(bundleDir, textModule[0]), "utf8")).toBe(
		"Hello from a text module"
	);
});
