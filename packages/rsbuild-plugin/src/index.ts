import assert from "node:assert";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { isBuiltin } from "node:module";
import * as path from "node:path";
import {
	BUILD_OUTPUT_ROOT,
	cleanBuildOutputDir,
	DEFAULT_WORKER_DIRECTORY_NAME,
	getWorkerAssetsDir,
	getWorkerBundleDir,
	writeRootConfig,
	writeWorkerConfig,
} from "@cloudflare/build-output-utils";
import {
	getDevVarsCandidatePaths,
	getEnvPaths,
} from "@cloudflare/workers-utils/local-env";
import { CoreHeaders } from "miniflare";
import { isPreviewBuild } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/build-output-env";
import {
	assertIsNotPreview,
	PluginContext,
} from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/context";
import { DEBUG_PATH } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/debug";
import { getPreviewMiniflareOptions } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/miniflare-options";
import { NodeJsCompatWarnings } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/nodejs-compat";
import {
	resolveDevOnly,
	resolveEnvDir,
	resolvePluginConfig,
} from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/plugin-config";
import {
	createRequestHandler,
	toMiniflareRequest,
} from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/utils";
import { handleWebSocket } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/websockets";
import { getDevMiniflareOptions } from "./miniflare-options";
import {
	createDebugMiddleware,
	createDispatchMiddleware,
	createStaticRoutingMiddleware,
	createUserWorkerHandler,
	getDevDebugWorkerNames,
	moveImportedAssets,
} from "./upstream/copied";
import {
	createDevServer,
	createLogger,
	createPreviewServer,
	createResolvedConfig,
	toViteHttpServer,
} from "./vite-server";
import {
	getAdditionalModuleTypes,
	getImportedAssetPaths,
	getManifestFromCompilation,
	getWorkerEntry,
	getWorkerEnvironmentConfig,
	removeUnemittedFiles,
} from "./worker-environment";
import type {
	AssetsOnlyPluginContext,
	PreviewPluginContext,
	WorkersPluginContext,
} from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/context";
import type {
	PluginConfig as VitePluginConfig,
	Worker,
} from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/plugin-config";
import type { DevHtmlHandlers } from "./miniflare-options";
import type { ServerConfig } from "./vite-server";
import type {
	EnvironmentContext,
	NormalizedConfig,
	PublicDir,
	RsbuildDevServer,
	RsbuildPlugin,
	RsbuildPreviewServer,
} from "@rsbuild/core";
import type { Miniflare, WorkerOptions } from "miniflare";
import type { IncomingMessage } from "node:http";

/** Options for the Rsbuild environment that builds a Worker. */
interface RsbuildEnvironmentOptions {
	/**
	 * The Rsbuild environment that builds the Worker, in place of the Vite
	 * plugin's `viteEnvironment`. `name` is its key in Rsbuild's
	 * `environments` config.
	 */
	rsbuildEnvironment?: { name?: string };
}

/** A Worker's options in the Vite plugin, with `rsbuildEnvironment` in place of `viteEnvironment`. */
type RsbuildWorkerOptions<T> = Omit<T, "viteEnvironment"> &
	RsbuildEnvironmentOptions;

/**
 * The same options as the Vite plugin's `cloudflare()`, apart from the tunnel,
 * with `rsbuildEnvironment` in place of `viteEnvironment`.
 */
export interface PluginConfig extends RsbuildWorkerOptions<
	Omit<VitePluginConfig, "tunnel" | "auxiliaryWorkers" | "prerenderWorker">
> {
	auxiliaryWorkers?: Array<
		RsbuildWorkerOptions<
			NonNullable<VitePluginConfig["auxiliaryWorkers"]>[number]
		>
	>;
	prerenderWorker?: RsbuildWorkerOptions<
		NonNullable<VitePluginConfig["prerenderWorker"]>
	>;
	/** The directory to load `.env` and `.dev.vars` files from, or `false` to skip them. Defaults to the project root. */
	envDir?: string | false;
	/** The mode used to load `cloudflare.config.ts`, `.env.[mode]` and `.dev.vars.[mode]`. Defaults to Rsbuild's mode. */
	envMode?: string;
}

/** The Rsbuild environment that builds the entry Worker, unless `rsbuildEnvironment.name` is set. */
const ENTRY_ENVIRONMENT_NAME = "cloudflare";

/** Logged in dev, preview and build, where the Vite plugin runs or builds Containers. */
const CONTAINERS_WARNING =
	"Containers aren't supported by the Rsbuild plugin yet, so Container-backed Durable Objects will fail.";

type MiniflareManifest = NonNullable<WorkerOptions["config"]["manifest"]>;

// As in the Vite plugin, the warnings that are still pending when the process
// exits (e.g. because the Worker failed to start) are rendered then.
let renderNodeJsCompatWarnings = () => {};
process.on("exit", () => renderNodeJsCompatWarnings());

/**
 * Rsbuild plugin that builds the Workers defined in `cloudflare.config.ts` and
 * the plugin options with rspack and runs them in workerd (via Miniflare)
 * during `rsbuild dev`. `rsbuild build` writes the Build Output Specification
 * to `.cloudflare/output`, which `rsbuild preview` runs in workerd.
 *
 * @param options Plugin options.
 * @returns An Rsbuild plugin.
 */
export function cloudflare(options: PluginConfig = {}): RsbuildPlugin {
	return {
		name: "rsbuild:cloudflare",
		setup(api) {
			const { action, rootPath: root } = api.context;
			const ctx = new PluginContext({
				restartingDevServerCount: 0,
				tunnelHostnames: new Set(),
			});
			const logger = createLogger(api.logger);
			/** The Workers to bundle, keyed by Rsbuild environment name. */
			const workerEnvironments = new Map<string, Worker>();
			/** The latest bundles, keyed by Worker name. */
			const manifests = new Map<string, MiniflareManifest>();
			let manifestsChanged = false;
			/** The assets that the entry Worker imports, which a build moves to the client output. */
			let importedAssets:
				| { environmentName: string; distPath: string; paths: string[] }
				| undefined;
			/** The Worker environments whose latest dev build failed. */
			const failedEnvironments = new Set<string>();
			let devServer: RsbuildDevServer | undefined;
			let environmentContexts: Record<string, EnvironmentContext> = {};
			let serverConfig: ServerConfig | undefined;
			let miniflareCreated = false;
			/** Whether the plugin prints the dev server's URLs, once it listens. */
			let printUrls = false;
			let devServerListening = false;
			/** Why Miniflare last failed to start or update, which requests report. */
			let miniflareError: unknown;
			/** Forwards WebSockets to the entry Worker, once Miniflare first starts. */
			let attachWebSockets: (() => void) | undefined;
			let settleFirstStart: () => void = () => {};
			/** Settles once Miniflare has first started, or failed to. */
			const firstStart = new Promise<void>((resolve) => {
				settleFirstStart = resolve;
			});

			api.modifyRsbuildConfig(async (userConfig, { mergeRsbuildConfig }) => {
				const {
					envDir,
					envMode,
					rsbuildEnvironment,
					auxiliaryWorkers,
					prerenderWorker,
					...pluginConfig
				} = options;
				const mode =
					envMode ??
					userConfig.mode ??
					(action === "dev" ? "development" : "production");
				const resolvedPluginConfig = await resolvePluginConfig(
					{
						...pluginConfig,
						viteEnvironment: {
							name: rsbuildEnvironment?.name ?? ENTRY_ENVIRONMENT_NAME,
						},
						auxiliaryWorkers: auxiliaryWorkers?.map(toViteWorkerOptions),
						prerenderWorker:
							prerenderWorker && toViteWorkerOptions(prerenderWorker),
					},
					{ root, mode, envDir },
					{
						command: action === "build" ? "build" : "serve",
						mode,
						isPreview: action === "preview",
					}
				);
				ctx.setResolvedPluginConfig(resolvedPluginConfig);
				ctx.setResolvedViteConfig(
					createResolvedConfig({
						root,
						mode,
						// As in Vite, a disabled public directory resolves to "".
						publicDir:
							getPublicDirs(userConfig.server?.publicDir, root)[0] ?? "",
						logger,
						logLevel: userConfig.logLevel,
					})
				);

				if (resolvedPluginConfig.type === "preview") {
					// Preview runs the Build Output rather than the project's sources,
					// and Rsbuild checks that this directory exists before starting.
					return mergeRsbuildConfig(userConfig, {
						output: { distPath: { root: BUILD_OUTPUT_ROOT } },
						server: {
							// Rsbuild sets up the server with `server.setup` before calling
							// plugins' `onBeforeStartPreviewServer`, so frameworks that
							// serve their server bundle this way (e.g. TanStack Start) would
							// otherwise handle requests in Node.js. As in Vite, Miniflare's
							// middleware precedes those of the plugins listed after this one.
							setup: (context) =>
								context.action === "preview"
									? setUpPreviewServer(context.server)
									: undefined,
						},
					});
				}

				for (const [
					name,
					worker,
				] of resolvedPluginConfig.environmentNameToWorkerMap) {
					// As the Vite plugin reserves Vite's client environment name.
					if (name === "web") {
						throw new Error(`"web" is a reserved Rsbuild environment name`);
					}
					const externals = [
						userConfig.output?.externals,
						userConfig.environments?.[name]?.output?.externals,
					]
						.flat()
						.filter((external) => external !== undefined);
					// The Vite plugin rejects `resolve.external` for Workers. Rsbuild also
					// applies top-level externals, often meant for the client, to every
					// environment, so only warn.
					if (
						!externals.every(
							(external) => typeof external === "string" && isBuiltin(external)
						)
					) {
						logger.warn(
							`The "${name}" environment's \`output.externals\` option is incompatible with the Cloudflare plugin, as workerd can't import external modules. To resolve this issue, avoid setting \`output.externals\` in your Cloudflare Worker environments.`
						);
					}
					if (action !== "build" || !resolveDevOnly(worker.devOnly)) {
						workerEnvironments.set(name, worker);
					}
				}

				// Without explicit environments (Rsbuild defaults them to `{}`), Rsbuild
				// builds a single `web` environment from the top-level config, so keep
				// it when there is a client entry. As in the Vite plugin, a Worker's
				// environment is never a client, even when the Worker isn't built.
				const clientEnvironments = Object.fromEntries(
					Object.entries(userConfig.environments ?? {}).filter(
						([name]) =>
							!resolvedPluginConfig.environmentNameToWorkerMap.has(name)
					)
				);
				const hasClientEntry =
					!!userConfig.source?.entry ||
					hasDefaultClientEntry(
						root,
						resolvedPluginConfig.environmentNameToWorkerMap.values()
					);
				const environments =
					Object.keys(clientEnvironments).length > 0
						? clientEnvironments
						: hasClientEntry
							? { web: {} }
							: {};
				const resolvedEnvDir = resolveEnvDir(root, envDir);
				// Rsbuild only prints the server's URLs for client environments.
				printUrls =
					Object.keys(environments).length === 0 &&
					userConfig.server?.printUrls === true;
				const nodeJsCompatWarnings = new Map(
					[...workerEnvironments]
						.filter(([, worker]) => !worker.nodeJsCompat)
						.map(([name]) => [
							name,
							new NodeJsCompatWarnings(name, ctx.resolvedViteConfig),
						])
				);
				renderNodeJsCompatWarnings = () => {
					for (const warnings of nodeJsCompatWarnings.values()) {
						warnings.renderWarnings();
					}
				};

				// The environments below already include the user's, so replace them
				// rather than merging them in again, which would apply their
				// functions (e.g. `tools.rspack`) and arrays twice.
				return mergeRsbuildConfig(
					{ ...userConfig, environments: {} },
					{
						environments: {
							...environments,
							...Object.fromEntries(
								[...workerEnvironments].map(([name, worker]) => [
									name,
									// The user's environment config overrides the defaults.
									mergeRsbuildConfig(
										getWorkerEnvironmentConfig(
											worker,
											root,
											mode,
											userConfig,
											name,
											nodeJsCompatWarnings.get(name)
										),
										userConfig.environments?.[name] ?? {}
									),
								])
							),
						},
						dev: {
							watchFiles: {
								paths: [
									...resolvedPluginConfig.configPaths,
									...getEnvPaths(resolvedEnvDir, mode),
									...getDevVarsCandidatePaths(resolvedEnvDir, mode),
									...(resolvedPluginConfig.experimental
										.headersAndRedirectsDevModeSupport
										? getPublicDirs(userConfig.server?.publicDir, root).flatMap(
												(dir) => [
													path.join(dir, "_headers"),
													path.join(dir, "_redirects"),
												]
											)
										: []),
								],
								type: "reload-server",
							},
						},
						server: {
							// The asset Worker handles HTML requests, as when deployed.
							htmlFallback: false,
							// Rsbuild prints the dev server's URLs before it listens, so they're
							// printed again once it does (see `onAfterStartDevServer`), as in
							// Vite.
							...(printUrls && {
								printUrls: ({ urls }: { urls: string[] }) =>
									action !== "dev" || devServerListening ? urls : undefined,
							}),
						},
					}
				);
			});

			api.modifyEnvironmentConfig((config, { name }) => {
				const worker = workerEnvironments.get(name);
				if (worker) {
					// As in the Vite plugin, the Worker is always written to its Build
					// Output location, whatever output directory is configured.
					config.output.distPath.root = getWorkerBundleDir(
						root,
						worker.directoryName
					);
					// Top-level entries are merged into every environment, so replace
					// them to keep client entries out of the Worker.
					config.source.entry = getWorkerEntry(worker, root);
					// Frameworks (e.g. TanStack Start) configure their server
					// environment to run in Node.js, but the Worker runs in workerd as
					// an ES module.
					config.output.target = "web-worker";
					config.output.module = true;
				} else if (
					action === "build" &&
					ctx.resolvedPluginConfig.type !== "preview" &&
					config.output.target === "web"
				) {
					config.output.distPath.root = getWorkerAssetsDir(root);
				}
			});

			api.onBeforeStartDevServer(({ server, environments }) => {
				devServer = server;
				environmentContexts = environments;
				serverConfig = getServerConfig(api.getNormalizedConfig(), server);
				const hmrPath = api.getNormalizedConfig().dev.client.path;
				assertIsNotPreview(ctx);
				const debugMiddleware = createDebugMiddleware(
					getDevDebugWorkerNames(ctx.resolvedPluginConfig),
					() => ctx.getResolvedInspectorPort()
				);
				if (debugMiddleware) {
					server.middlewares.use(DEBUG_PATH, debugMiddleware);
				}
				// Frameworks (e.g. TanStack Start) serve their server bundle with
				// `loadBundle()`, which would run the Worker in Node.js, so return a
				// module whose `fetch` sends requests to the Worker in workerd.
				for (const [name, { config }] of workerEnvironments) {
					const environment = server.environments[name];
					if (environment) {
						environment.loadBundle = async <T>() =>
							({
								default: {
									fetch: (request: Request) =>
										fetchWorker(request, config.name),
								},
							}) as T;
					}
				}
				const { entryWorkerConfig } = ctx;
				if (entryWorkerConfig) {
					const { httpServer } = server;
					if (httpServer) {
						attachWebSockets = () =>
							handleWebSocket(
								toViteHttpServer(httpServer, hmrPath),
								ctx.miniflare,
								entryWorkerConfig.name
							);
					}
					const userWorkerHandler = createUserWorkerHandler(
						getMiniflare,
						entryWorkerConfig.name
					);
					// Local trigger routes (e.g. `/cdn-cgi/local/scheduled`) must reach
					// the entry Worker rather than the router Worker.
					server.middlewares.use("/cdn-cgi/local/", userWorkerHandler);
					const staticRouting =
						entryWorkerConfig.assets?.runWorkerFirst === true
							? { user_worker: ["/*"] }
							: ctx.resolvedPluginConfig.type === "workers"
								? ctx.resolvedPluginConfig.staticRouting
								: undefined;
					if (staticRouting) {
						server.middlewares.use(
							createStaticRoutingMiddleware(staticRouting, userWorkerHandler)
						);
					}
				}
				// Rsbuild would serve its HTML pages itself, so send page requests to
				// the router Worker first.
				server.middlewares.use((req, res, next) =>
					isPageRequest(req, hmrPath)
						? dispatchMiddleware(req, res, next)
						: next()
				);
				// Runs after Rsbuild's built-in middleware, so client assets are
				// served first and every other request is handled by the router Worker.
				return () => {
					server.middlewares.use(dispatchMiddleware);
				};
			});

			api.onAfterStartDevServer(() => {
				devServerListening = true;
				if (printUrls) {
					devServer?.printUrls();
				}
			});

			api.onBeforeBuild({
				// Runs before Rsbuild empties the output directories and copies
				// `public/` into them, so that the copies aren't removed.
				order: "pre",
				async handler({ isFirstCompile }) {
					if (isFirstCompile) {
						// As in the Vite plugin, drop Workers and Containers from
						// previous builds.
						await cleanBuildOutputDir(root);
					}
				},
			});

			api.onAfterEnvironmentCompile(async ({ environment, stats }) => {
				const worker = workerEnvironments.get(environment.name);
				if (!worker || !stats) {
					return;
				}
				if (stats.hasErrors()) {
					failedEnvironments.add(environment.name);
					return;
				}
				failedEnvironments.delete(environment.name);
				manifests.set(worker.config.name, {
					...getManifestFromCompilation(stats.compilation),
					modulesRoot: environment.distPath,
				});
				manifestsChanged = true;
				if (action === "build") {
					// Record the imported assets before awaiting anything: Rsbuild calls
					// `onAfterBuild` as soon as the last environment finishes, which
					// may be while this hook is still running for an earlier one.
					if (worker.directoryName === DEFAULT_WORKER_DIRECTORY_NAME) {
						importedAssets = {
							environmentName: environment.name,
							distPath: environment.distPath,
							paths: getImportedAssetPaths(stats.compilation),
						};
					}
					await removeUnemittedFiles(environment.distPath, stats.compilation);
				}
			});

			api.onAfterDevCompile(async () => {
				if (failedEnvironments.size > 0) {
					miniflareError = new Error(
						"The Worker failed to build. See the dev server output for details."
					);
					settleFirstStart();
					return;
				}
				// Miniflare runs every Worker, so wait until they have all built, and
				// don't restart it when only client code changed.
				if (
					(miniflareCreated && !manifestsChanged) ||
					manifests.size < workerEnvironments.size
				) {
					return;
				}
				manifestsChanged = false;
				try {
					const { miniflareOptions, containerOptions } =
						await getDevMiniflareOptions(
							ctx as AssetsOnlyPluginContext | WorkersPluginContext,
							createDevServer(
								(req, res) => devServer?.middlewares(req, res),
								serverConfig ?? getServerConfig(api.getNormalizedConfig()),
								logger
							),
							{ manifests, html: htmlHandlers }
						);
					if (containerOptions) {
						// As in the Vite plugin, once per dev server rather than on every update.
						logger.warnOnce(CONTAINERS_WARNING);
					}
					await startOrUpdateMiniflare(miniflareOptions);
					miniflareError = undefined;
					attachWebSockets?.();
					attachWebSockets = undefined;
				} catch (error) {
					// Keep the dev server running, so that fixing the Worker retries.
					miniflareError = error;
					api.logger.error(error);
				}
				settleFirstStart();
			});

			api.onCloseDevServer(() => ctx.disposeMiniflare());

			/** Runs the Build Output in Miniflare, which serves every preview request. */
			async function setUpPreviewServer(
				server: RsbuildPreviewServer
			): Promise<void> {
				const config = getServerConfig(api.getNormalizedConfig(), server);
				const { miniflareOptions, containerOptions } =
					await getPreviewMiniflareOptions(
						ctx as PreviewPluginContext,
						createPreviewServer(config, logger)
					);
				if (containerOptions) {
					logger.warn(CONTAINERS_WARNING);
				}
				await startOrUpdateMiniflare(miniflareOptions);
				settleFirstStart();
				// Rsbuild has no preview close hook, so dispose with the HTTP server.
				server.httpServer?.on("close", () => void ctx.disposeMiniflare());
				const workerNames = miniflareOptions.workers.flatMap(
					({ config: { name } }) => name ?? []
				);
				const debugMiddleware = createDebugMiddleware(workerNames, () =>
					ctx.getResolvedInspectorPort()
				);
				if (debugMiddleware) {
					server.middlewares.use(DEBUG_PATH, debugMiddleware);
				}
				const { httpServer } = server;
				if (httpServer) {
					handleWebSocket(toViteHttpServer(httpServer), ctx.miniflare);
				}
				// As in the Vite plugin, put the middleware before Rsbuild's so that
				// Miniflare serves the assets as well, as it would when deployed.
				server.middlewares.use(
					createRequestHandler(async (request) =>
						(await getMiniflare()).dispatchFetch(request, {
							redirect: "manual",
						})
					)
				);
			}

			api.onAfterBuild(async ({ stats }) => {
				const { resolvedPluginConfig } = ctx;
				if (resolvedPluginConfig.type === "preview" || stats?.hasErrors()) {
					return;
				}
				const assetsDir = getWorkerAssetsDir(root);
				if (!fs.existsSync(assetsDir)) {
					// Without a client entry there's no web environment to copy
					// `public/` into the assets directory, as Vite's client build does.
					for (const { name, copyOnBuild } of api.getNormalizedConfig().server
						.publicDir) {
						// Rsbuild normalizes `name` to an absolute path.
						if (copyOnBuild && fs.existsSync(name)) {
							await fsp.cp(name, assetsDir, { recursive: true });
						}
					}
				}
				if (importedAssets) {
					// As in the Vite plugin, serve assets that the entry Worker imports.
					moveImportedAssets({
						importedAssetPaths: importedAssets.paths,
						entryWorkerBuildDirectory: importedAssets.distPath,
						clientBuildDirectory: assetsDir,
						entryWorkerEnvironmentName: importedAssets.environmentName,
						root,
						logger,
					});
				}
				if (resolvedPluginConfig.type === "assets-only") {
					await writeWorkerConfig({
						root,
						config: resolvedPluginConfig.config,
					});
				}
				for (const worker of resolvedPluginConfig.environmentNameToWorkerMap.values()) {
					if (!resolveDevOnly(worker.devOnly)) {
						const manifest = manifests.get(worker.config.name);
						assert(
							manifest,
							`Expected Worker "${worker.config.name}" to be built`
						);
						await writeWorkerConfig({
							root,
							config: worker.config,
							manifest: {
								type: "partial",
								mainModule: manifest.mainModule,
								modules: getAdditionalModuleTypes(manifest.modules),
							},
							directoryName: worker.directoryName,
						});
					} else if (worker.directoryName === DEFAULT_WORKER_DIRECTORY_NAME) {
						// `assetsOnly`: the entry Worker runs in dev but deploys as assets.
						if (!fs.existsSync(assetsDir)) {
							throw new Error(
								"If `assetsOnly` is set to `true`, the client environment must be built"
							);
						}
						await writeWorkerConfig({
							root,
							config: worker.config,
							directoryName: worker.directoryName,
						});
					}
				}
				if (resolvedPluginConfig.containers.length > 0) {
					// Rsbuild may build again in watch mode.
					logger.warnOnce(CONTAINERS_WARNING);
				}
				await writeRootConfig(root, resolvedPluginConfig.settings, {
					isPreview: isPreviewBuild(),
					mode: ctx.resolvedViteConfig.mode,
				});
			});

			async function startOrUpdateMiniflare(
				miniflareOptions: Parameters<PluginContext["startOrUpdateMiniflare"]>[0]
			): Promise<void> {
				await ctx.startOrUpdateMiniflare(miniflareOptions);
				miniflareCreated = true;
				await ctx.miniflare.ready;
			}

			async function getMiniflare(): Promise<Miniflare> {
				await firstStart;
				if (miniflareError) {
					throw miniflareError;
				}
				return ctx.miniflare;
			}

			/**
			 * Sends a request to a Worker, bypassing the router Worker, as the
			 * middleware from `createUserWorkerHandler` does.
			 */
			async function fetchWorker(
				request: Request,
				workerName: string
			): Promise<Response> {
				const miniflareRequest = toMiniflareRequest(request);
				miniflareRequest.headers.set(CoreHeaders.ROUTE_OVERRIDE, workerName);
				const response = await (
					await getMiniflare()
				).dispatchFetch(miniflareRequest, { redirect: "manual" });
				return response as unknown as Response;
			}

			/** Forwards a request to the router Worker, or to the asset Worker for asset requests. */
			const dispatchMiddleware = createDispatchMiddleware(getMiniflare);

			/** Reads HTML pages from Rsbuild for the asset Worker. */
			const htmlHandlers: DevHtmlHandlers = {
				async htmlExists(pathname) {
					return !!(findHtmlEntry(pathname) || findPublicFile(pathname));
				},
				async fetchHtml(pathname) {
					const entry = findHtmlEntry(pathname);
					const environment =
						entry && devServer?.environments[entry.environmentName];
					if (entry && environment) {
						return environment.getTransformedHtml(entry.entryName);
					}
					const publicFile = findPublicFile(pathname);
					if (!publicFile) {
						throw new Error(`No HTML found for "${pathname}".`);
					}
					return fsp.readFile(publicFile, "utf8");
				},
			};

			function findHtmlEntry(
				pathname: string
			): { environmentName: string; entryName: string } | undefined {
				const { base } = api.getNormalizedConfig().server;
				for (const [environmentName, { htmlPaths }] of Object.entries(
					environmentContexts
				)) {
					for (const [entryName, htmlPath] of Object.entries(htmlPaths)) {
						if (path.posix.join(base, htmlPath) === pathname) {
							return { environmentName, entryName };
						}
					}
				}
			}

			function findPublicFile(pathname: string): string | undefined {
				return getPublicDirs(api.getNormalizedConfig().server.publicDir, root)
					.map((dir) => path.join(dir, pathname))
					.find((file) =>
						fs.statSync(file, { throwIfNoEntry: false })?.isFile()
					);
			}
		},
	};
}

/**
 * Maps a Worker's `rsbuildEnvironment` option to the Vite plugin's
 * `viteEnvironment`, which its config resolution reads.
 *
 * @param options The Worker's options.
 * @returns The options that the Vite plugin accepts.
 */
function toViteWorkerOptions<T extends RsbuildEnvironmentOptions>({
	rsbuildEnvironment,
	...options
}: T): Omit<T, "rsbuildEnvironment"> & {
	viteEnvironment?: { name?: string };
} {
	return {
		...options,
		...(rsbuildEnvironment && {
			viteEnvironment: { name: rsbuildEnvironment.name },
		}),
	};
}

/**
 * Whether the project has a client without `source.entry`: Rsbuild's default
 * entry (`src/index.*`) exists and isn't a Worker's entrypoint, and, as Vite
 * builds the client when it does, `index.html` exists at the root.
 *
 * @param root The project root.
 * @param workers The Workers, whose entrypoints aren't client entries.
 * @returns Whether Rsbuild should build a client from its default entry.
 */
function hasDefaultClientEntry(
	root: string,
	workers: Iterable<Worker>
): boolean {
	if (!fs.existsSync(path.join(root, "index.html"))) {
		return false;
	}
	// As Rsbuild's `getDefaultEntry`, which it doesn't export.
	const entry = ["ts", "js", "tsx", "jsx", "mts", "cts", "mjs", "cjs"]
		.map((extension) => path.join(root, `src/index.${extension}`))
		.find((file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile());
	return (
		entry !== undefined &&
		[...workers].every(
			({ config }) => path.resolve(root, config.entrypoint) !== entry
		)
	);
}

/**
 * Gets the server settings that the Vite plugin's internals read.
 *
 * @param config Rsbuild's normalized config.
 * @param server The dev or preview server, if it has been created.
 * @returns The server settings.
 */
function getServerConfig(
	{ server }: NormalizedConfig,
	{ port }: { port: number } = server
): ServerConfig {
	return {
		host: server.host,
		// Unlike Vite, Rsbuild resolves the port that the server listens on (e.g.
		// when the configured port is 0 or taken) before creating it, so Workers
		// get the server's URL from the start.
		port,
		https: !!server.https,
		headers: server.headers ?? {},
	};
}

/** Resolves Rsbuild's `server.publicDir` option to absolute directories. */
function getPublicDirs(
	publicDir: PublicDir | undefined,
	root: string
): string[] {
	if (publicDir === false) {
		return [];
	}
	return [publicDir ?? {}]
		.flat()
		.map(({ name = "public" }) => path.resolve(root, name));
}

/**
 * Whether a request is for a page, which Rsbuild would otherwise serve itself:
 * a `GET` or `HEAD` for an HTML file or an extension-less path, other than
 * Rsbuild's own routes.
 */
function isPageRequest(req: IncomingMessage, hmrPath: string): boolean {
	const { pathname } = new URL(req.url ?? "/", "http://localhost");
	return (
		(req.method === "GET" || req.method === "HEAD") &&
		pathname !== hmrPath &&
		!/^\/(__|rsbuild-)/.test(pathname) &&
		(pathname.endsWith(".html") || path.posix.extname(pathname) === "")
	);
}
