import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeDir } from "@cloudflare/workers-utils";

/**
 * Packs `rsbuild-plugin-cloudflare` for the seeded projects to install. It's
 * private, so it can't be published to the mock npm registry. Its dependencies
 * are the Vite plugin's, which the registry does publish.
 *
 * The test workers inherit the tarball's path through the environment, as the
 * seed module runs outside of the Vitest instance that `provide()` targets.
 *
 * @returns Removes the tarball.
 */
export default async function setup(): Promise<() => Promise<void>> {
	const packDir = await fs.mkdtemp(
		path.join(await fs.realpath(os.tmpdir()), "rsbuild-plugin-")
	);
	const output = execFileSync(
		"pnpm",
		["pack", "--json", "--pack-destination", packDir],
		{
			cwd: path.resolve(import.meta.dirname, "../../rsbuild-plugin"),
			encoding: "utf8",
			shell: process.platform === "win32",
		}
	);
	process.env.CLOUDFLARE_RSBUILD_PLUGIN_TARBALL = (
		JSON.parse(output) as { filename: string }
	).filename;
	return () => removeDir(packDir);
}
