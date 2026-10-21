import { Response as MiniflareResponse } from "miniflare";
import { ASSET_WORKER_NAME } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/constants";
import { getDevMiniflareOptions as getViteDevMiniflareOptions } from "../../../../workers-sdk/packages/vite-plugin-cloudflare/src/miniflare-options";
import type { WorkerOptions } from "miniflare";

type MiniflareManifest = NonNullable<WorkerOptions["config"]["manifest"]>;

/** Reads the dev server's HTML pages for the asset Worker. */
export interface DevHtmlHandlers {
	/** Whether there is an HTML page at a pathname that ends with `.html`. */
	htmlExists(pathname: string): Promise<boolean>;
	/** Gets the HTML page at a pathname, transformed by the dev server. */
	fetchHtml(pathname: string): Promise<string>;
}

/**
 * Gets the Vite plugin's dev Miniflare options with the user Workers running
 * the Rsbuild bundles instead of Vite's module runner, and with the asset
 * Worker reading HTML pages from Rsbuild instead of Vite.
 *
 * @param ctx The plugin context.
 * @param viteDevServer The Vite dev server backed by Rsbuild's.
 * @param options.manifests The Workers' bundles, keyed by Worker name.
 * @param options.html Reads the dev server's HTML pages.
 * @returns The Miniflare options and the Containers to prepare.
 */
export async function getDevMiniflareOptions(
	ctx: Parameters<typeof getViteDevMiniflareOptions>[0],
	viteDevServer: Parameters<typeof getViteDevMiniflareOptions>[1],
	{
		manifests,
		html,
	}: { manifests: Map<string, MiniflareManifest>; html: DevHtmlHandlers }
): ReturnType<typeof getViteDevMiniflareOptions> {
	const { miniflareOptions, containerOptions } =
		await getViteDevMiniflareOptions(ctx, viteDevServer);
	// Only the module runner imports modules through the fallback service.
	const { unsafeModuleFallbackService: _, ...options } = miniflareOptions;

	return {
		containerOptions,
		miniflareOptions: {
			...options,
			workers: options.workers.map((worker) => {
				if (worker.config.name === ASSET_WORKER_NAME) {
					return withHtmlHandlers(worker, html);
				}
				const manifest = manifests.get(worker.config.name ?? "");
				if (!manifest) {
					// One of the Vite plugin's internal Workers.
					return worker;
				}
				const {
					__VITE_INVOKE_MODULE__: _invokeModule,
					__VITE_RUNNER_OBJECT__: _runnerBinding,
					...env
				} = worker.config.env ?? {};
				const { __VITE_RUNNER_OBJECT__: _runnerObject, ...exports } =
					worker.config.exports ?? {};
				const {
					useModuleFallbackService: _useModuleFallbackService,
					unsafeEvalBinding: _unsafeEvalBinding,
					...dev
				} = worker.dev ?? {};
				return { config: { ...worker.config, env, exports, manifest }, dev };
			}),
		},
	};
}

/** Replaces the asset Worker's bindings that read HTML pages from Vite. */
function withHtmlHandlers(
	worker: WorkerOptions,
	html: DevHtmlHandlers
): WorkerOptions {
	return {
		...worker,
		config: {
			...worker.config,
			env: {
				...worker.config.env,
				__VITE_HTML_EXISTS__: {
					type: "fetcher",
					async handler(request) {
						const { pathname } = new URL(request.url);
						return MiniflareResponse.json(
							pathname.endsWith(".html") && (await html.htmlExists(pathname))
								? pathname
								: null
						);
					},
				},
				__VITE_FETCH_HTML__: {
					type: "fetcher",
					async handler(request) {
						const { pathname } = new URL(request.url);
						try {
							return new MiniflareResponse(await html.fetchHtml(pathname), {
								headers: { "Content-Type": "text/html" },
							});
						} catch (error) {
							throw new Error(
								`Unexpected error. Failed to load "${pathname}".`,
								{ cause: error }
							);
						}
					},
				},
			},
		},
	};
}
