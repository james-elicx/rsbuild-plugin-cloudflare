/**
 * The Worker's config, for every app: `scripts/test.ts` gives each app a
 * `cloudflare.config.ts` that re-exports it. It's the config of TanStack's
 * Cloudflare example (`e2e/react-start/basic-cloudflare`), with the entrypoint
 * that `scripts/test.ts` writes for the suite, and the suite's variables.
 */
import { defineConfig } from "cf/config";
import { findSuite, workerEntrypointFile } from "./apps.ts";

// oxlint-disable-next-line turbo/no-undeclared-env-vars -- `scripts/test.ts` sets it, outside Turbo.
const suite = findSuite(process.env.TANSTACK_START_E2E_SUITE ?? "")?.suite;

export default defineConfig({
	worker: {
		name: "tanstack-start-e2e",
		entrypoint: `./${workerEntrypointFile}`,
		compatibilityDate: "2025-09-24",
		compatibilityFlags: ["nodejs_compat"],
		// Some apps read the suite's variables at runtime too, from
		// `process.env`, which has the Worker's vars.
		env: Object.fromEntries(
			Object.entries(suite?.env ?? {}).map(([name, value]) => [
				name,
				{ type: "text" as const, value },
			])
		),
	},
});
