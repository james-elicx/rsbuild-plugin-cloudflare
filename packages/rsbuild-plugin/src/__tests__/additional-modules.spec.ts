import * as fs from "node:fs";
import * as path from "node:path";
import { readBuildOutput } from "@cloudflare/build-output-utils";
import { describe, test, vi } from "vitest";
import {
	build,
	copyFixture,
	startDevServer,
	startPreviewServer,
} from "./helpers";

/** The fixture's routes, which each use an additional module. */
const routes = ["/wasm", "/wasm-init", "/text", "/bin"];

const expectedResponses = {
	"/wasm": "7",
	"/wasm-init": "11",
	"/text": "Hello from a text module",
	"/bin": "4",
};

const waitForOptions = { timeout: 10_000, interval: 100 };

async function getResponses(url: string): Promise<Record<string, string>> {
	return Object.fromEntries(
		await Promise.all(
			routes.map(async (route) => {
				const response = await fetch(new URL(route, url));
				return [route, await response.text()];
			})
		)
	);
}

/** Changes the fixture's entrypoint, but not the module that imports the additional modules. */
function changeEntrypoint(root: string, message: string) {
	const indexPath = path.join(root, "src", "index.ts");
	fs.writeFileSync(
		indexPath,
		fs
			.readFileSync(indexPath, "utf8")
			.replace(/"Hello from [^"]*"/, JSON.stringify(message))
	);
}

// `src/modules/index.ts` imports the additional modules, and stands in for a
// dependency, which rebuilds don't change.
describe("additional-modules", () => {
	test("keeps the modules that an unchanged module imports after rebuilds", async ({
		expect,
	}) => {
		const root = copyFixture("additional-modules");
		const url = await startDevServer(root);

		expect(await getResponses(url)).toEqual(expectedResponses);

		for (const message of ["Hello from a rebuild", "Hello from another"]) {
			changeEntrypoint(root, message);
			await vi.waitFor(async () => {
				expect(await (await fetch(url)).text()).toBe(message);
			}, waitForOptions);
			expect(await getResponses(url)).toEqual(expectedResponses);
		}
	});

	test("reloads the modules when their files change", async ({ expect }) => {
		const root = copyFixture("additional-modules");
		const url = await startDevServer(root);
		const wasmPath = path.join(root, "src", "modules", "add.wasm");

		expect(await getResponses(url)).toEqual(expectedResponses);

		// Replaces the function's `i32.add` instruction with `i32.mul`.
		const wasm = fs.readFileSync(wasmPath);
		wasm[wasm.lastIndexOf(0x6a)] = 0x6c;
		fs.writeFileSync(wasmPath, wasm);
		fs.writeFileSync(
			path.join(root, "src", "modules", "message.txt"),
			"Hello from a changed text module"
		);

		await vi.waitFor(async () => {
			expect(await getResponses(url)).toEqual({
				...expectedResponses,
				"/wasm": "12",
				"/wasm-init": "30",
				"/text": "Hello from a changed text module",
			});
		}, waitForOptions);
	});

	test("builds and previews the Worker with the modules", async ({
		expect,
	}) => {
		const root = copyFixture("additional-modules");
		await build(root);
		const url = await startPreviewServer(root);

		expect(await getResponses(url)).toEqual(expectedResponses);

		const { workers } = await readBuildOutput(root);
		const modules = workers.default?.config.manifest?.modules ?? {};
		// The `.wasm` module is emitted once, although it's imported directly and
		// with `?init`.
		expect(Object.keys(modules).sort()).toEqual([
			expect.stringMatching(/^add-[0-9a-f]{8}\.wasm$/),
			expect.stringMatching(/^data-[0-9a-f]{8}\.bin$/),
			"index.js",
			"index.js.map",
			expect.stringMatching(/^message-[0-9a-f]{8}\.txt$/),
		]);
		expect(Object.values(modules).map(({ type }) => type)).toEqual(
			expect.arrayContaining(["wasm", "data", "text"])
		);
		// The bundle imports the modules by their file names, rather than by the
		// paths that their references record.
		const bundle = fs.readFileSync(
			path.join(root, ".cloudflare/output/v0/workers/default/bundle/index.js"),
			"utf8"
		);
		expect(bundle).not.toContain("__CLOUDFLARE_MODULE__");
		expect(bundle).not.toContain(root);
	});
});
