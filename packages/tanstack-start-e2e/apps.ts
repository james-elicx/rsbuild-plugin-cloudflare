import * as path from "node:path";

/** How a suite's app is served: by `rsbuild dev`, or by `rsbuild preview` after `rsbuild build`. */
export type Serve = "dev" | "preview";

/** A test that is skipped, and why. */
interface Skip {
	/** The test's file, relative to the app's `tests` directory. */
	file: string;
	/** The test's title, or the start of it. Omit to skip the whole file. */
	title?: string;
	reason: string;
}

/**
 * A run of an app's tests, with the app served by the plugin: one of TanStack's
 * Rsbuild runs (its `package.json`'s `nx.metadata.playwrightModes`), served
 * as the app's config serves it, or `basic`'s tests in dev.
 */
export interface Suite {
	serve: Serve;
	/** The `MODE` that TanStack runs the tests with, which the apps read. */
	mode: string;
	/** Distinguishes the suites of an app that are served alike. */
	variant?: string;
	/** Other environment variables that TanStack runs the tests with. */
	env?: Record<string, string>;
	/**
	 * The Worker's entrypoint, relative to the app, for an app with its own
	 * server entry (`src/server.ts`, or its `server.entry` option). Defaults to
	 * TanStack Start's.
	 */
	entrypoint?: string;
	skips?: Skip[];
}

/** An app in TanStack/router's `e2e/react-start`, tested with the plugin. */
export interface App {
	/** The app's directory in `e2e/react-start`. */
	name: string;
	suites: Suite[];
}

/** The checkout of TanStack/router, prepared by `scripts/setup.ts`. */
export const tanstackRouterDir = path.resolve(
	import.meta.dirname,
	"../../tanstack-router"
);

const productionOnlyScripts: Skip[] = [
	"client side navigating to a route with scripts",
	"directly going to a route with scripts",
].map((title) => ({
	file: "navigation.spec.ts",
	title,
	reason: "`__root.tsx` only adds the script in production",
}));

/**
 * Skips tests of responses' custom status text, which the Vite plugin's dev
 * and preview servers don't send: they write responses with
 * `@remix-run/node-fetch-server`'s `sendResponse`, which sends the status
 * code only.
 */
function customStatusText(file: string, titles: string[]): Skip[] {
	return titles.map((title) => ({
		file,
		title,
		reason: "The Vite plugin's servers don't send custom status text",
	}));
}

const responseReconciliationSkips = customStatusText(
	"response-reconciliation.spec.ts",
	[
		"regression #5407: global middleware setResponseHeaders and status apply before next",
		"global middleware helper changes apply after next",
		"route middleware helper changes apply before and after next",
		"helper changes overlay same-boundary returned response conflicts",
		"loader helper headers, status, and cookies reconcile onto document response",
		"global middleware after next reconciles onto document response",
		"global request middleware helper changes reconcile onto serialized responses",
		"global request middleware helper changes after next reconcile onto serialized responses",
		"function middleware helper changes after next reconcile onto serialized responses",
		"raw server function responses reconcile helper changes after next",
	]
);

/**
 * The apps, and their suites. Not included:
 *
 * - `basic`'s `spa` and `prerender` runs: the plugin doesn't support
 *   prerendering (see its README). Its `preview` run serves its `ssr` build
 *   with `rsbuild preview`, as its `ssr` run here does.
 * - `import-protection`: its global setup serves the app itself, with
 *   `pnpm exec rsbuild dev` and the app's own config, and reads the log of
 *   TanStack's Nx build.
 * - `rsbuild`: its tests serve the app themselves, with `pnpm exec rsbuild dev`.
 * - `rsc` and `rsc-rsbuild`: React Server Components don't work with the plugin
 *   yet. The Worker's render fails because client references are missing from
 *   React's client manifest.
 * - Dev runs of the apps that TanStack only tests in production, apart from
 *   `basic`: some of their tests expect production builds (e.g.
 *   `server-functions`' explicit server function IDs).
 */
export const apps: App[] = [
	{
		name: "basic",
		suites: [
			{ serve: "dev", mode: "ssr", skips: productionOnlyScripts },
			{ serve: "preview", mode: "ssr" },
			{
				serve: "preview",
				mode: "ssr",
				variant: "iife",
				env: { TSS_RSB_CLIENT_OUTPUT: "iife" },
			},
		],
	},
	{
		name: "css-inline",
		suites: [
			{ serve: "preview", mode: "ssr", entrypoint: "./src/server.ts" },
			{
				serve: "preview",
				mode: "ssr",
				variant: "transform-assets",
				env: { CSS_INLINE_TRANSFORM_ASSETS: "true" },
				entrypoint: "./src/server.ts",
			},
		],
	},
	{
		name: "css-modules",
		suites: [{ serve: "preview", mode: "ssr" }],
	},
	{
		name: "deferred-hydration",
		suites: [{ serve: "preview", mode: "ssr" }],
	},
	{
		name: "hmr",
		suites: [{ serve: "dev", mode: "ssr" }],
	},
	{
		name: "response-reconciliation",
		suites: [
			{ serve: "preview", mode: "ssr", skips: responseReconciliationSkips },
			{
				serve: "preview",
				mode: "ssr",
				variant: "custom-entry",
				env: { TSS_E2E_SERVER_ENTRY: "server-entry" },
				entrypoint: "./src/server-entry.ts",
				skips: responseReconciliationSkips,
			},
		],
	},
	{
		name: "server-functions",
		suites: [
			{
				serve: "preview",
				mode: "ssr",
				skips: [
					...customStatusText("server-functions.spec.ts", [
						"invoking a server function with custom response status code",
					]),
					{
						file: "server-functions.spec.ts",
						title: "server function's dead code is preserved if already there",
						reason:
							"The server function writes a file to the app's directory, which a Worker can't",
					},
				],
			},
		],
	},
	{
		name: "session-handling",
		suites: [{ serve: "preview", mode: "ssr" }],
	},
];

/**
 * Returns a suite's ID, e.g. `basic:preview` or `basic:preview:spa`.
 *
 * @param app The suite's app.
 * @param suite The suite.
 * @returns The ID, which `scripts/test.ts` selects suites by.
 */
export function getSuiteId(app: App, suite: Suite): string {
	const variant =
		suite.variant ??
		(suite.mode === "ssr" || suite.mode === suite.serve
			? undefined
			: suite.mode);
	return [app.name, suite.serve, variant]
		.filter((part) => part !== undefined)
		.join(":");
}

/**
 * Finds the suite that an ID belongs to.
 *
 * @param id The suite's ID.
 * @returns The suite and its app, or `undefined` if there's no such suite.
 */
export function findSuite(id: string): { app: App; suite: Suite } | undefined {
	for (const app of apps) {
		const suite = app.suites.find(
			(candidate) => getSuiteId(app, candidate) === id
		);
		if (suite !== undefined) {
			return { app, suite };
		}
	}
	return undefined;
}

/**
 * Returns an app's directory in the TanStack/router checkout.
 *
 * @param app The app.
 * @returns The absolute path of its directory.
 */
export function getAppDir(app: App): string {
	return path.join(tanstackRouterDir, "e2e/react-start", app.name);
}
