import { defineConfig } from "@rsbuild/core";
import { cloudflare } from "rsbuild-plugin-cloudflare";

export default defineConfig({
	source: { entry: { index: "./src/index.ts" } },
	plugins: [cloudflare({ types: { includeRuntime: false } })],
});
