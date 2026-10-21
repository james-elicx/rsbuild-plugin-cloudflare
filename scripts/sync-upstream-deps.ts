/**
 * Keeps this repository's dependencies in line with the workers-sdk submodule:
 *
 * - The plugin's runtime dependencies are the Vite plugin's, at the versions in
 *   the submodule, as the plugin bundles the Vite plugin's internals.
 * - The packages that the Vite plugin's internals import from the submodule's
 *   workspace are linked to the submodule with `overrides` in
 *   `pnpm-workspace.yaml`.
 * - The shared tooling (TypeScript, Vitest, oxlint...) and the Node.js and pnpm
 *   versions are workers-sdk's.
 *
 * Usage: node --experimental-strip-types scripts/sync-upstream-deps.ts [--check]
 */
import {
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	engines?: Record<string, string>;
	volta?: Record<string, string>;
	packageManager?: string;
	version: string;
}

/** The tooling that is pinned to the versions installed in the submodule. */
const TOOLING = [
	"@cloudflare/workers-types",
	"@types/node",
	"cf",
	"cross-env",
	"eslint-plugin-turbo",
	"oxfmt",
	"oxlint",
	"oxlint-tsgolint",
	"tsdown",
	"turbo",
	"typescript",
	"vitest",
];

const root = path.resolve(import.meta.dirname, "..");
const upstreamRoot = path.join(root, "workers-sdk");
const vitePluginRoot = path.join(
	upstreamRoot,
	"packages/vite-plugin-cloudflare"
);
// Where to look for the tooling: the root first, then the Vite plugin, then the
// other workspace packages.
const upstreamPackageDirs = [
	upstreamRoot,
	vitePluginRoot,
	...readdirSync(path.join(upstreamRoot, "packages")).map((name) =>
		path.join(upstreamRoot, "packages", name)
	),
];
const check = process.argv.includes("--check");
const problems: string[] = [];

function readPackageJson(directory: string): PackageJson {
	return JSON.parse(
		readFileSync(path.join(directory, "package.json"), "utf8")
	) as PackageJson;
}

/**
 * Gets the directory of a package installed in the submodule, as resolved from
 * one of its workspace packages.
 *
 * @param name The package's name.
 * @param from The directories to resolve the package from, in order.
 * @returns The package's real directory, if it's installed.
 */
function findInstalledPackage(
	name: string,
	from: string[]
): string | undefined {
	for (const directory of from) {
		try {
			return realpathSync(path.join(directory, "node_modules", name));
		} catch {
			// Not installed here.
		}
	}
	return undefined;
}

/**
 * Updates (or with `--check`, checks) a set of dependencies.
 *
 * @param label Where the dependencies are, for messages.
 * @param actual The dependencies, which are updated in place.
 * @param expected The expected versions, keyed by name.
 * @param options.exhaustive Whether `actual` should only have the expected dependencies.
 */
function syncDependencies(
	label: string,
	actual: Record<string, string>,
	expected: Record<string, string>,
	{ exhaustive }: { exhaustive: boolean }
): void {
	for (const [name, version] of Object.entries(expected)) {
		if (actual[name] !== version) {
			problems.push(
				`${label}: "${name}" should be "${version}", not "${actual[name] ?? "missing"}".`
			);
			actual[name] = version;
		}
	}
	if (exhaustive) {
		for (const name of Object.keys(actual)) {
			if (!(name in expected)) {
				problems.push(`${label}: "${name}" isn't a Vite plugin dependency.`);
				delete actual[name];
			}
		}
	}
}

function sortKeys(record: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
	);
}

// The Vite plugin's runtime dependencies, and the overrides that link the ones
// from the submodule's workspace.
const vitePluginDependencies: Record<string, string> = {};
const overrides: Record<string, string> = {};
for (const [name, spec] of Object.entries(
	readPackageJson(vitePluginRoot).dependencies ?? {}
)) {
	const directory = findInstalledPackage(name, [vitePluginRoot]);
	if (!directory) {
		throw new Error(
			`"${name}" isn't installed in the submodule. Run \`pnpm setup:upstream\`.`
		);
	}
	vitePluginDependencies[name] = readPackageJson(directory).version;
	if (spec.startsWith("workspace:")) {
		overrides[name] =
			`link:./${path.relative(root, directory).replaceAll(path.sep, "/")}`;
	}
}

const upstreamPackageJson = readPackageJson(upstreamRoot);
const packageJsonPaths = [
	".",
	"packages/rsbuild-plugin",
	"packages/test-harness",
];
for (const relativePath of packageJsonPaths) {
	const directory = path.join(root, relativePath);
	const packageJson = readPackageJson(directory);
	const label = path.join(relativePath, "package.json");

	if (relativePath === "packages/rsbuild-plugin") {
		packageJson.dependencies ??= {};
		syncDependencies(
			`${label} dependencies`,
			packageJson.dependencies,
			vitePluginDependencies,
			{ exhaustive: true }
		);
		packageJson.dependencies = sortKeys(packageJson.dependencies);
	}

	const devDependencies = packageJson.devDependencies ?? {};
	const tooling: Record<string, string> = {};
	// Linked tooling (e.g. the harness's Vitest) is the submodule's already.
	for (const name of TOOLING.filter(
		(dep) => dep in devDependencies && !devDependencies[dep].startsWith("link:")
	)) {
		const installed = findInstalledPackage(name, upstreamPackageDirs);
		if (!installed) {
			throw new Error(`"${name}" isn't installed in the submodule.`);
		}
		tooling[name] = readPackageJson(installed).version;
	}
	syncDependencies(`${label} devDependencies`, devDependencies, tooling, {
		exhaustive: false,
	});

	if (relativePath === ".") {
		for (const key of ["engines", "volta", "packageManager"] as const) {
			if (
				JSON.stringify(packageJson[key]) !==
				JSON.stringify(upstreamPackageJson[key])
			) {
				problems.push(`${label}: "${key}" should match workers-sdk's.`);
				Object.assign(packageJson, { [key]: upstreamPackageJson[key] });
			}
		}
	}

	if (!check) {
		writeFileSync(
			path.join(directory, "package.json"),
			JSON.stringify(packageJson, null, "\t") + "\n"
		);
	}
}

// The `overrides` block in `pnpm-workspace.yaml`.
const workspacePath = path.join(root, "pnpm-workspace.yaml");
const workspace = readFileSync(workspacePath, "utf8");
const overridesBlock = [
	"overrides:",
	...Object.entries(sortKeys(overrides)).map(([name, target]) => {
		const key = /^[a-z][\w-]*$/.test(name) ? name : JSON.stringify(name);
		return `  ${key}: ${JSON.stringify(target)}`;
	}),
].join("\n");
const updatedWorkspace = workspace.replace(
	/^overrides:\n(?: {2}.*\n)*/m,
	`${overridesBlock}\n`
);
if (updatedWorkspace !== workspace) {
	problems.push(
		`pnpm-workspace.yaml: "overrides" should be:\n${overridesBlock}`
	);
	if (!check) {
		writeFileSync(workspacePath, updatedWorkspace);
	}
}

if (check && problems.length > 0) {
	console.error(
		[
			"The dependencies are out of line with the workers-sdk submodule:",
			...problems.map((problem) => `  - ${problem}`),
			"",
			"Run `node --experimental-strip-types scripts/sync-upstream-deps.ts`, then `pnpm install`.",
		].join("\n")
	);
	process.exitCode = 1;
} else {
	for (const problem of problems) {
		console.log(`Updated: ${problem}`);
	}
	if (problems.length === 0) {
		console.log("The dependencies are in line with the workers-sdk submodule.");
	}
}
