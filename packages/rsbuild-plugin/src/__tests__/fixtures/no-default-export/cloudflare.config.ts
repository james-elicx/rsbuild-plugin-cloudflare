import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "rsbuild-no-default-export",
		entrypoint,
		compatibilityDate: "2025-06-01",
	},
});
