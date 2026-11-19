import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { removeDir } from "@cloudflare/workers-utils";
import {
	getLocalVersion,
	rewriteManifest,
} from "../../../workers-sdk/packages/mock-npm-registry/src/local-versions.ts";
import vitePluginPackage from "../../../workers-sdk/packages/vite-plugin-cloudflare/package.json" with { type: "json" };
import type {
	LocalVersion,
	PackageManifest,
} from "../../../workers-sdk/packages/mock-npm-registry/src/local-versions.ts";

const vitePluginRoot = path.resolve(
	import.meta.dirname,
	"../../../workers-sdk/packages/vite-plugin-cloudflare"
);

/**
 * Packs `rsbuild-plugin-cloudflare` for the seeded projects to install. It's
 * private, so it can't be published to the mock npm registry. Its dependencies
 * are the Vite plugin's, which the registry does publish.
 *
 * The registry publishes the workspace's packages (e.g. Miniflare) under local
 * versions, which the Vite plugin's manifest depends on. The tarball's
 * manifest is rewritten in the same way, so that the plugin runs on the
 * workspace's packages too, rather than on their npm releases.
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
	const tarball = (JSON.parse(output) as { filename: string }).filename;

	execFileSync("tar", ["-xzf", tarball, "-C", packDir]);
	const manifestPath = path.join(packDir, "package", "package.json");
	const manifest = JSON.parse(
		await fs.readFile(manifestPath, "utf8")
	) as PackageManifest;
	await fs.writeFile(
		manifestPath,
		JSON.stringify(rewriteManifest(manifest, await getLocalVersions()), null, 2)
	);
	execFileSync("tar", ["-czf", tarball, "-C", packDir, "package"]);

	process.env.CLOUDFLARE_RSBUILD_PLUGIN_TARBALL = tarball;
	return () => removeDir(packDir);
}

/**
 * Gets the local versions that the mock npm registry publishes the Vite
 * plugin's workspace dependencies under.
 *
 * @returns The versions, keyed by package name.
 */
async function getLocalVersions(): Promise<Map<string, LocalVersion>> {
	const localVersions = new Map<string, LocalVersion>();
	for (const [name, specifier] of Object.entries(
		vitePluginPackage.dependencies
	)) {
		if (!specifier.startsWith("workspace:")) {
			continue;
		}
		const { version } = JSON.parse(
			await fs.readFile(
				path.join(vitePluginRoot, "node_modules", name, "package.json"),
				"utf8"
			)
		) as { version: string };
		localVersions.set(name, { from: version, to: getLocalVersion(version) });
	}
	return localVersions;
}
