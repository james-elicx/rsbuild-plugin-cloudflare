/**
 * The workers-sdk internals that the plugin reuses. This directory is the only
 * place that imports workers-sdk sources (from the `workers-sdk` submodule), so
 * that upstream changes surface here when the submodule is bumped.
 */

export {
	getDevVarsCandidatePaths,
	getEnvPaths,
} from "@cloudflare/workers-utils/local-env";
export { PluginContext } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/context";
export { DEBUG_PATH } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/debug";
export { isPreviewBuild } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/build-output-env";
export { getPreviewMiniflareOptions } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/miniflare-options";
export {
	hasNodeJsAls,
	isNodeAlsModule,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/nodejs-compat";
export {
	resolveDevOnly,
	resolvePluginConfig,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/plugin-config";
export { createRequestHandler } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/utils";
export {
	createDebugMiddleware,
	createDispatchMiddleware,
	createStaticRoutingMiddleware,
	createUserWorkerHandler,
	getWasmInitModule,
	matchAdditionalModule,
	moduleRuleFilters,
	moveImportedAssets,
	toModuleType,
	wasmInitRE,
} from "./copied";
export { handleWebSocket } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/websockets";
export { getDevMiniflareOptions } from "./miniflare-options";
export {
	createDevServer,
	createLogger,
	createPreviewServer,
	createResolvedConfig,
	toViteHttpServer,
} from "./vite-server";
export type { ServerConfig } from "./vite-server";
export type { DevHtmlHandlers } from "./miniflare-options";
export type {
	AssetsOnlyPluginContext,
	PreviewPluginContext,
	WorkersPluginContext,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/context";
export type { NodeJsCompat } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/nodejs-compat";
export type {
	PluginConfig,
	ResolvedPluginConfig,
	Worker,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/plugin-config";
