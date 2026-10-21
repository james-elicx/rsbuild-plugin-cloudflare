import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Imports Node.js built-ins without the `nodejs_compat` compatibility flag.
export default defineConfig({
	worker: {
		name: "rsbuild-nodejs-imports",
		entrypoint,
		compatibilityDate: "2025-06-01",
	},
});
