import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import e2eConfig from "../../workers-sdk/packages/vite-plugin-cloudflare/e2e/vitest.config.ts";

/**
 * Runs the Vite plugin's e2e suite against `rsbuild-plugin-cloudflare`.
 * `seed()` converts each fixture to an Rsbuild project with `e2e-seed.ts` (see
 * `patches/0003-e2e-seed-hook.patch`).
 *
 * Run it from the upstream `e2e` directory (see `pnpm test:e2e`): the mock npm
 * registry finds the packages to publish with `turbo query` in the working
 * directory.
 */
export default mergeConfig(
	e2eConfig,
	defineConfig({
		test: {
			env: {
				CLOUDFLARE_VITE_E2E_SEED_MODULE: path.resolve(
					import.meta.dirname,
					"src/e2e-seed.ts"
				),
				// Vitest sets `NODE_ENV=test`, which the commands inherit. The Rsbuild
				// CLI would then load `.env.test` and `.env` files into `process.env`,
				// where they take precedence over the plugin's `.env.[mode]` files. An
				// empty value lets Rsbuild set it as usual.
				NODE_ENV: "",
			},
			globalSetup: [
				path.resolve(import.meta.dirname, "src/e2e-global-setup.ts"),
			],
			exclude: [
				"**/node_modules/**",
				// Asserts the Vite plugin's validation of Vite environment options.
				"invalid-worker-environment-options.test.ts",
				// Asserts that the warning names Vite's "ssr" environment (the Rsbuild
				// plugin's is "cloudflare"), and that `vite dev` exits when workerd
				// fails to start, whereas `rsbuild dev` keeps running so that fixing
				// the Worker retries.
				"nodejs-compat-warnings.test.ts",
				// Containers aren't supported yet.
				"containers-image-free.test.ts",
			],
		},
	})
);
