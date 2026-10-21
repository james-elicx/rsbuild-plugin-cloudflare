import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "@rsbuild/core";
import { describe, test, vi } from "vitest";
import { build, copyFixture } from "./helpers";

describe("nodejs-imports", () => {
	test("warns about Node.js imports without the `nodejs_compat` flag", async ({
		expect,
	}) => {
		const root = copyFixture("nodejs-imports");
		const customLogger = createLogger();
		const warn = vi.spyOn(customLogger, "warn").mockImplementation(() => {});

		await build(root, { customLogger });

		// As in the Vite plugin, the imports are left for workerd to reject.
		const bundle = fs.readFileSync(
			path.join(root, ".cloudflare/output/v0/workers/default/bundle/index.js"),
			"utf8"
		);
		expect(bundle).toContain('from "node:assert/strict"');
		expect(bundle).toContain('from "node:events"');
		await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
		// The imports are resolved in parallel, so their order varies.
		const [message] = warn.mock.calls[0] ?? [];
		expect(message).toMatch(
			/^Unexpected Node\.js imports for environment "cloudflare"\. Do you need to enable the "nodejs_compat" compatibility flag\? Refer to https:\/\/developers\.cloudflare\.com\/workers\/runtime-apis\/nodejs\/ for more details\.\n/
		);
		const importer = path.join("src", "index.ts");
		expect(message).toContain(
			` - "node:assert/strict" imported from "${importer}"\n`
		);
		expect(message).toContain(` - "events" imported from "${importer}"\n`);
	});
});
