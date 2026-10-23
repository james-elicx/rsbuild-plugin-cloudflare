/**
 * Node.js module hooks for the app's Rsbuild process, registered by
 * `register-node-hooks.ts`:
 *
 * - `@rsbuild/core` is resolved from this package, for the app and TanStack's
 *   packages as well as for the plugin, which needs a newer version than
 *   TanStack's lockfile has. A single copy, as in a real app: the plugin and
 *   TanStack's packages apply rspack plugins to Rsbuild's compiler.
 * - Relative imports without an extension are resolved to `.ts` files, as
 *   bundlers do, so that Node.js can load the app's `rsbuild.config.ts`
 *   natively, and so the hooks apply to the modules that it imports. (Rsbuild's
 *   jiti loader would transform and resolve them itself.)
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolveHook } from "node:module";

const packageJsonUrl = pathToFileURL(
	path.join(import.meta.dirname, "package.json")
).href;

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
	if (specifier === "@rsbuild/core" || specifier.startsWith("@rsbuild/core/")) {
		return nextResolve(specifier, { ...context, parentURL: packageJsonUrl });
	}
	if (
		specifier.startsWith(".") &&
		path.extname(specifier) === "" &&
		context.parentURL?.includes("/node_modules/") === false
	) {
		try {
			return await nextResolve(specifier, context);
		} catch {
			return nextResolve(`${specifier}.ts`, context);
		}
	}
	return nextResolve(specifier, context);
};
