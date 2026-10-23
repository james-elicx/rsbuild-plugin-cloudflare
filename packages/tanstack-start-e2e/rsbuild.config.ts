/**
 * The Rsbuild config that the apps are served with, from their directories
 * (e.g. `rsbuild dev --config <this file>`): the app's own `rsbuild.config.ts`,
 * with the plugin added as TanStack's Cloudflare example adds the Vite plugin
 * (`e2e/react-start/basic-cloudflare`), and the API mock.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "@rsbuild/core";
import { cloudflare } from "rsbuild-plugin-cloudflare";
import { tanstackRouterDir } from "./apps.ts";
import type { RsbuildConfigDefinition, RsbuildPlugin } from "@rsbuild/core";

const workerEnvironmentName = "ssr";

/** Adds `worker-api-mock.ts` before the Worker's entry. */
const workerApiMock: RsbuildPlugin = {
	name: "tanstack-start-e2e:worker-api-mock",
	setup(api) {
		api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) =>
			name === workerEnvironmentName
				? mergeEnvironmentConfig(config, {
						source: {
							preEntry: [path.join(import.meta.dirname, "worker-api-mock.ts")],
						},
						resolve: {
							alias: {
								"tanstack-e2e-api-handlers": path.join(
									tanstackRouterDir,
									"e2e/e2e-utils/src/api-handlers.ts"
								),
							},
						},
					})
				: config
		);
	},
};

export default defineConfig(async (params) => {
	// Loaded natively, with the hooks in `node-hooks.ts`.
	const { default: appConfigExport } = (await import(
		pathToFileURL(path.join(process.cwd(), "rsbuild.config.ts")).href
	)) as { default: RsbuildConfigDefinition };
	const appConfig =
		typeof appConfigExport === "function"
			? await appConfigExport(params)
			: appConfigExport;

	return {
		...appConfig,
		plugins: [
			cloudflare({
				rsbuildEnvironment: { name: workerEnvironmentName },
				inspectorPort: false,
				// As `basic-cloudflare/wrangler.jsonc` does.
				config: {
					entrypoint: "@tanstack/react-start/server-entry",
					compatibilityDate: "2025-09-24",
					compatibilityFlags: ["nodejs_compat"],
				},
			}),
			workerApiMock,
			...(appConfig.plugins ?? []),
		],
	};
});
