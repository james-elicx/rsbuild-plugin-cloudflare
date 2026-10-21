import * as path from "node:path";
import { defineConfig } from "tsdown";

const upstreamPlugin = "../../workers-sdk/packages/vite-plugin-cloudflare";
const viteShim = path.resolve("src/vite-shim.ts");

export default defineConfig({
	entry: { index: "src/index.ts" },
	platform: "node",
	outDir: "dist",
	tsconfig: "tsconfig.json",
	plugins: [
		{
			// The Vite plugin's internals only import a few values from `vite` (see
			// `vite-shim.ts`). Their declarations still use Vite's types.
			name: "vite-shim",
			resolveId(id, importer) {
				if (id === "vite" && !importer?.endsWith(".d.ts")) {
					return viteShim;
				}
			},
		},
	],
	inputOptions: {
		treeshake: {
			// The Vite plugin's modules define its Vite plugins at the top level with
			// `createPlugin()`, which only wraps a factory. Marking it pure leaves
			// them (and their dependencies) out when we import a module's helpers.
			manualPureFunctions: ["createPlugin"],
		},
		onLog(level, log, handler) {
			// Fail rather than bundle `undefined` when the internals import a value
			// from `vite` that the shim doesn't provide.
			if (log.code === "IMPORT_IS_UNDEFINED" && log.message.includes("vite")) {
				handler("error", log);
			} else {
				handler(level, log);
			}
		},
	},
	// The internals read the Vite plugin's internal Workers relative to the
	// bundle (e.g. `./workers/router-worker/index.js`), so ship its builds.
	copy: [{ from: `${upstreamPlugin}/dist/workers`, to: "dist/workers" }],
	dts: true,
});
