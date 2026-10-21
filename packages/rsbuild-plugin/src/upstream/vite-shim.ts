import * as path from "node:path";

/**
 * Stands in for `vite` when bundling the Vite plugin's internals (see
 * `tsdown.config.ts`). They only import these values from `vite` at runtime,
 * and the build fails if they start importing anything else.
 */

/**
 * The Vite version that the internals see. They only use it to choose the
 * module runner that Vite plugin Workers load, which this plugin replaces.
 */
export const version = "8.0.0";

/**
 * Converts a path to a POSIX path, as Vite's `normalizePath` does.
 *
 * @param id The path to normalize.
 * @returns The normalized path.
 */
export function normalizePath(id: string): string {
	return path.posix.normalize(
		process.platform === "win32" ? id.replaceAll("\\", "/") : id
	);
}
