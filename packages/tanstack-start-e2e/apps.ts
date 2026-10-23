import * as path from "node:path";

/** How an app is served: by `rsbuild dev`, or by `rsbuild preview` after `rsbuild build`. */
export type Mode = "dev" | "preview";

/** A test that is skipped, and why. */
interface Skip {
	/** The test's file, relative to the app's `tests` directory. */
	file: string;
	/** The test's title, or the start of it. */
	title: string;
	reason: string;
}

/** An app in TanStack/router's `e2e/react-start`, tested with the plugin. */
export interface App {
	/** The app's directory in `e2e/react-start`. */
	name: string;
	/** The modes that it's tested in. */
	modes: Mode[];
	/** Tests that are skipped, by mode. */
	skips?: Partial<Record<Mode, Skip[]>>;
}

/** The checkout of TanStack/router, prepared by `scripts/setup.ts`. */
export const tanstackRouterDir = path.resolve(
	import.meta.dirname,
	"../../tanstack-router"
);

export const apps: App[] = [
	{
		name: "basic",
		modes: ["dev", "preview"],
		skips: {
			// TanStack only tests `basic` with production builds.
			dev: [
				{
					file: "navigation.spec.ts",
					title: "client side navigating to a route with scripts",
					reason: "`__root.tsx` only adds the script in production",
				},
				{
					file: "navigation.spec.ts",
					title: "directly going to a route with scripts",
					reason: "`__root.tsx` only adds the script in production",
				},
			],
		},
	},
];

/**
 * Returns an app's directory in the TanStack/router checkout.
 *
 * @param app The app.
 * @returns The absolute path of its directory.
 */
export function getAppDir(app: App): string {
	return path.join(tanstackRouterDir, "e2e/react-start", app.name);
}
