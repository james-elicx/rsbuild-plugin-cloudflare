/**
 * The Rsbuild config that the apps are served with, from their directories
 * (e.g. `rsbuild dev --config <this file>`): the app's own `rsbuild.config.ts`,
 * with the plugin added as its README describes, and the alias that the API
 * mock needs.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "@rsbuild/core";
import { cloudflare } from "rsbuild-plugin-cloudflare";
import { tanstackRouterDir } from "./apps.ts";
import type { RsbuildConfigDefinition, RsbuildPlugin } from "@rsbuild/core";

const workerEnvironmentName = "ssr";

/** Resolves the MSW handlers that `worker-api-mock.ts` passes requests to. */
const workerApiMock: RsbuildPlugin = {
	name: "tanstack-start-e2e:worker-api-mock",
	setup(api) {
		api.modifyEnvironmentConfig((config, { name, mergeEnvironmentConfig }) =>
			name === workerEnvironmentName
				? mergeEnvironmentConfig(config, {
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
			// The Worker's config is in `cloudflare.config.ts`.
			cloudflare({
				rsbuildEnvironment: { name: workerEnvironmentName },
				inspectorPort: false,
			}),
			workerApiMock,
			...(appConfig.plugins ?? []),
		],
	};
});
