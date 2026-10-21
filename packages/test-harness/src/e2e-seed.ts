import * as fs from "node:fs/promises";
import * as path from "node:path";
import harnessPackage from "../package.json" with { type: "json" };

/**
 * Turns a seeded Vite fixture into the equivalent Rsbuild project: the
 * `cloudflare()` options are passed to the Rsbuild plugin's `cloudflare()`,
 * with `viteEnvironment` renamed to `rsbuildEnvironment`, and the `vite`
 * scripts become `rsbuild` ones. The e2e helpers (`seed()`) call this
 * when `CLOUDFLARE_VITE_E2E_SEED_MODULE` points at this module.
 *
 * @param projectPath The seeded project
 */
export async function afterSeed(projectPath: string): Promise<void> {
	const tarball = process.env.CLOUDFLARE_RSBUILD_PLUGIN_TARBALL;
	if (!tarball) {
		throw new Error("The Rsbuild plugin wasn't packed by the global setup.");
	}
	const pkgPath = path.join(projectPath, "package.json");
	const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8")) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		scripts: Record<string, string>;
	};
	const { devDependencies: versions } = harnessPackage;
	for (const deps of [pkg.dependencies, pkg.devDependencies]) {
		if (deps?.["@cloudflare/vite-plugin"]) {
			delete deps["@cloudflare/vite-plugin"];
			delete deps.vite;
			deps["rsbuild-plugin-cloudflare"] = `file:${tarball}`;
			deps["@rsbuild/core"] = versions["@rsbuild/core"];
		}
		if (deps?.["@vitejs/plugin-react"]) {
			delete deps["@vitejs/plugin-react"];
			deps["@rsbuild/plugin-react"] = versions["@rsbuild/plugin-react"];
		}
	}
	for (const [name, script] of Object.entries(pkg.scripts)) {
		pkg.scripts[name] = script.replace(
			/\bvite(?: (dev|build|preview))?\b/g,
			(_, command = "dev") => `rsbuild ${command}`
		);
	}
	await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

	const files = await fs.readdir(projectPath);
	const viteConfigFile = files.find((file) =>
		/^vite\.config\.m?[jt]s$/.test(file)
	);
	if (!viteConfigFile) {
		throw new Error(`No Vite config found in ${projectPath}.`);
	}
	let config = await fs.readFile(
		path.join(projectPath, viteConfigFile),
		"utf8"
	);
	for (const [from, to] of [
		[
			`import { cloudflare } from "@cloudflare/vite-plugin";`,
			`import { cloudflare } from "rsbuild-plugin-cloudflare";`,
		],
		[
			`import react from "@vitejs/plugin-react";`,
			`import { pluginReact as react } from "@rsbuild/plugin-react";`,
		],
		[
			`import { defineConfig } from "vite";`,
			`import { defineConfig } from "@rsbuild/core";`,
		],
	] as const) {
		config = config.replace(from, to);
	}
	if (config.includes("childEnvironments")) {
		throw new Error(
			`${viteConfigFile} uses child environments, which the Rsbuild plugin doesn't support.`
		);
	}
	config = config.replaceAll("viteEnvironment", "rsbuildEnvironment");
	if (/from "(vite|@vitejs\/.*|@cloudflare\/vite-plugin)"/.test(config)) {
		throw new Error(
			`${viteConfigFile} has imports with no Rsbuild equivalent.`
		);
	}

	// Vite uses `index.html` as the client entry, whereas Rsbuild injects the
	// page's script into the HTML. Vite also resolves root-relative imports
	// (e.g. `/vite.svg`) from `public/`.
	const htmlPath = path.join(projectPath, "index.html");
	const scriptRE = /\s*<script type="module" src="\/([^"]+)"><\/script>/;
	const html = files.includes("index.html")
		? await fs.readFile(htmlPath, "utf8")
		: "";
	const script = html.match(scriptRE)?.[1];
	if (script) {
		await fs.writeFile(htmlPath, html.replace(scriptRE, ""));
		config = config.replace(
			"defineConfig({",
			[
				"defineConfig({",
				`source: { entry: { index: "./${script}" } },`,
				`html: { template: "./index.html" },`,
				"tools: { rspack: { resolve: { roots: [`${import.meta.dirname}/public`] } } },",
			].join("\n\t")
		);
	}
	await fs.writeFile(
		path.join(projectPath, viteConfigFile.replace("vite", "rsbuild")),
		config
	);
	await fs.rm(path.join(projectPath, viteConfigFile));
}
