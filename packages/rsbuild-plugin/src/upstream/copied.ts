/**
 * Code copied from the Vite plugin, where it's inlined in Vite hooks rather
 * than exported. This directory only holds such copies; everything else
 * imports workers-sdk directly. Every copy is recorded in
 * `upstream-copies.json`, and `pnpm check:copied-code` fails when its upstream
 * source changes, so that the copy is reviewed when the submodule is bumped.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CoreHeaders } from "miniflare";
import colors from "picocolors";
import {
	ASSET_WORKER_NAME,
	kRequestType,
	ROUTER_WORKER_NAME,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/constants";
import { getDebugPathHtml } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/debug";
import { UNKNOWN_HOST } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/shared";
import { createRequestHandler } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/utils";
import { generateStaticRoutingRuleMatcher } from "../../../../workers-sdk/packages/workers-shared/asset-worker/src/utils/rules-engine";
import type {
	AssetsOnlyResolvedConfig,
	WorkersResolvedConfig,
} from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/plugin-config";
import type { StaticRouting } from "../../../../workers-sdk/packages/workers-shared/utils/types";
import type { Miniflare } from "miniflare";
import type { IncomingMessage, ServerResponse } from "node:http";

type Middleware = (
	req: IncomingMessage,
	res: ServerResponse,
	next: (error?: unknown) => void
) => void;

// From `plugins/wasm.ts`.

/**
 * Gets the module that a `.wasm?init` import loads (the Vite plugin's `load`
 * hook).
 *
 * @param wasmPath The path of the `.wasm` file.
 * @returns The module's code.
 */
export function getWasmInitModule(wasmPath: string): string {
	return `
					import wasm from "${wasmPath}";
					export default function(opts = {}) {
						return WebAssembly.instantiate(wasm, opts);
					}
				`;
}

// From `plugins/dev.ts` and `plugins/trigger-handlers.ts`.

/**
 * Creates the middleware that sends requests to the entry Worker, bypassing the
 * router Worker.
 *
 * @param getMiniflare Gets the Miniflare instance once it has started.
 * @param entryWorkerName The entry Worker's name.
 * @returns The middleware.
 */
export function createUserWorkerHandler(
	getMiniflare: () => Promise<Miniflare>,
	entryWorkerName: string
): Middleware {
	const requestHandler = createRequestHandler(async (request) => {
		request.headers.set(CoreHeaders.ROUTE_OVERRIDE, entryWorkerName);

		return (await getMiniflare()).dispatchFetch(request, {
			redirect: "manual",
		});
	});
	return (req, res, next) => void requestHandler(req, res, next);
}

/**
 * Creates the middleware that applies the entry Worker's `run_worker_first`
 * rules, before the dev server serves client assets.
 *
 * @param staticRouting The static routing rules.
 * @param userWorkerHandler Sends requests to the entry Worker.
 * @returns The middleware.
 */
export function createStaticRoutingMiddleware(
	staticRouting: StaticRouting,
	userWorkerHandler: Middleware
): Middleware {
	const excludeRulesMatcher = generateStaticRoutingRuleMatcher(
		staticRouting.asset_worker ?? []
	);
	const includeRulesMatcher = generateStaticRoutingRuleMatcher(
		staticRouting.user_worker
	);

	return function cloudflarePreMiddleware(req, res, next) {
		const request = req as IncomingMessage & { [kRequestType]?: string };
		// Only the URL pathname is used to match rules
		const rulesRequest = new Request(new URL(req.url ?? "/", UNKNOWN_HOST));

		if (request[kRequestType] === "asset") {
			next();
		} else if (excludeRulesMatcher({ request: rulesRequest })) {
			request[kRequestType] = "asset";
			next();
		} else if (includeRulesMatcher({ request: rulesRequest })) {
			userWorkerHandler(req, res, next);
		} else {
			next();
		}
	};
}

/**
 * Creates the middleware that sends requests to the asset Worker when the
 * request is for an asset, and to the router Worker otherwise.
 *
 * @param getMiniflare Gets the Miniflare instance once it has started.
 * @returns The middleware.
 */
export function createDispatchMiddleware(
	getMiniflare: () => Promise<Miniflare>
): Middleware {
	const requestHandler = createRequestHandler(async (request, req) => {
		request.headers.set(
			CoreHeaders.ROUTE_OVERRIDE,
			(req as { [kRequestType]?: string })[kRequestType] === "asset"
				? ASSET_WORKER_NAME
				: ROUTER_WORKER_NAME
		);

		return (await getMiniflare()).dispatchFetch(request, {
			redirect: "manual",
		});
	});
	return (req, res, next) => void requestHandler(req, res, next);
}

// From `plugins/debug.ts`.

/**
 * Gets the Workers that the dev server's `/__debug` page lists (none for an
 * assets-only config).
 *
 * @param resolvedPluginConfig The resolved plugin config.
 * @returns The Workers' names.
 */
export function getDevDebugWorkerNames(
	resolvedPluginConfig: AssetsOnlyResolvedConfig | WorkersResolvedConfig
): string[] {
	return resolvedPluginConfig.type === "workers"
		? [...resolvedPluginConfig.environmentNameToWorkerMap.values()].map(
				(worker) => worker.config.name
			)
		: [];
}

/**
 * Creates the `/__debug` middleware, which opens DevTools for the Workers.
 *
 * @param workerNames The Workers to debug.
 * @param getResolvedInspectorPort Gets Miniflare's inspector port, if any.
 * @returns The middleware, or `undefined` in a VS Code JavaScript Debug
 * terminal, where it isn't added.
 */
export function createDebugMiddleware(
	workerNames: string[],
	getResolvedInspectorPort: () => Promise<number | null>
): Middleware | undefined {
	// If we're in a JavaScript Debug terminal, Miniflare will send the inspector ports directly to VSCode for registration.
	// As such, we don't need our inspector proxy and in fact including it causes issues with multiple clients connected to the
	// inspector endpoint.
	const isInVscodeJsDebugTerminal = !!process.env.VSCODE_INSPECTOR_OPTIONS;

	if (isInVscodeJsDebugTerminal) {
		return;
	}

	return async (_, res, next) => {
		const resolvedInspectorPort = await getResolvedInspectorPort();

		if (resolvedInspectorPort) {
			const html = getDebugPathHtml(workerNames, resolvedInspectorPort);
			res.setHeader("Content-Type", "text/html");
			res.end(html);
		} else {
			next();
		}
	};
}

// From `build.ts`.

/**
 * Moves assets imported in the entry Worker to the client build, and logs how
 * many were moved.
 *
 * @param options The assets and build directories.
 * @param options.importedAssetPaths The assets' paths relative to both directories.
 * @param options.entryWorkerBuildDirectory The entry Worker's build directory.
 * @param options.clientBuildDirectory The client build directory.
 * @param options.entryWorkerEnvironmentName The entry Worker's environment name.
 * @param options.root The project root.
 * @param options.logger Logs the moved assets.
 */
export function moveImportedAssets({
	importedAssetPaths,
	entryWorkerBuildDirectory,
	clientBuildDirectory,
	entryWorkerEnvironmentName,
	root,
	logger,
}: {
	importedAssetPaths: Iterable<string>;
	entryWorkerBuildDirectory: string;
	clientBuildDirectory: string;
	entryWorkerEnvironmentName: string;
	root: string;
	logger: { info: (message: string) => void };
}): void {
	const movedAssetPaths: string[] = [];

	// Move assets imported in the entry Worker to the client build
	for (const assetPath of importedAssetPaths) {
		const src = path.join(entryWorkerBuildDirectory, assetPath);
		const dest = path.join(clientBuildDirectory, assetPath);

		if (!fs.existsSync(src)) {
			continue;
		}

		if (fs.existsSync(dest)) {
			fs.unlinkSync(src);
		} else {
			const destDir = path.dirname(dest);
			fs.mkdirSync(destDir, { recursive: true });
			fs.renameSync(src, dest);
			movedAssetPaths.push(dest);
		}
	}

	if (movedAssetPaths.length) {
		logger.info(
			[
				`${colors.green("✓")} ${movedAssetPaths.length} asset${
					movedAssetPaths.length > 1 ? "s" : ""
				} moved from "${entryWorkerEnvironmentName}" to "client" build output.`,
				...movedAssetPaths.map((assetPath) =>
					colors.dim(path.relative(root, assetPath))
				),
			].join("\n")
		);
	}
}
