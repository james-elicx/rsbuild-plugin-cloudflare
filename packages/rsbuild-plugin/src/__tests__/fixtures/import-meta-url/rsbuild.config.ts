import { defineConfig } from "@rsbuild/core";
import { cloudflare } from "rsbuild-plugin-cloudflare";

export default defineConfig({
	plugins: [cloudflare({ types: { includeRuntime: false } })],
});
