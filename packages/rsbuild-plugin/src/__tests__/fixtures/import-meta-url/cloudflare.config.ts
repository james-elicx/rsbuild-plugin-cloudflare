import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "rsbuild-import-meta-url",
		entrypoint,
		compatibilityDate: "2025-06-01",
	},
});
