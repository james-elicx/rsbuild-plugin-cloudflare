import { EventEmitter } from "node:events";
import type { PluginContext } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/context";
import type { getPreviewMiniflareOptions } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/miniflare-options";
import type { handleWebSocket } from "../../../workers-sdk/packages/vite-plugin-cloudflare/src/websockets";
import type { getDevMiniflareOptions } from "./miniflare-options";
import type { Logger as RsbuildLogger } from "@rsbuild/core";
import type { Server } from "node:http";
import type { Http2SecureServer } from "node:http2";

// The Vite types that the internals read, derived from them so that this
// package doesn't depend on Vite.
type ResolvedConfig = Parameters<PluginContext["setResolvedViteConfig"]>[0];
type Logger = ResolvedConfig["logger"];
type ViteDevServer = Parameters<typeof getDevMiniflareOptions>[1];
type PreviewServer = Parameters<typeof getPreviewMiniflareOptions>[1];
type ServerOptions = ResolvedConfig["server"];
type HttpServer = Parameters<typeof handleWebSocket>[0];

/**
 * The internals only read some properties of Vite's objects, so the others are
 * left out.
 */
type DeepPartial<T> = T extends (...args: never[]) => unknown
	? T
	: T extends object
		? { [K in keyof T]?: DeepPartial<T[K]> }
		: T;

function fromPartial<T>(value: DeepPartial<T>): T {
	return value as T;
}

/** The server settings that the internals read. */
export interface ServerConfig {
	host: string | undefined;
	port: number;
	https: boolean;
	headers: Record<string, string | string[]>;
}

/**
 * Creates a Vite logger that writes to Rsbuild's logger.
 *
 * @param logger Rsbuild's logger.
 * @returns A Vite logger.
 */
export function createLogger(logger: RsbuildLogger): Logger {
	const warnings = new Set<string>();
	const viteLogger: Logger = {
		hasWarned: false,
		info: (message) => logger.info(message),
		warn(message) {
			viteLogger.hasWarned = true;
			logger.warn(message);
		},
		warnOnce(message) {
			if (!warnings.has(message)) {
				warnings.add(message);
				viteLogger.warn(message);
			}
		},
		error: (message) => logger.error(message),
		clearScreen() {},
		hasErrorLogged: () => false,
	};
	return viteLogger;
}

/**
 * Creates the resolved Vite config that the internals read.
 *
 * @param config The project's settings.
 * @returns A partial resolved Vite config.
 */
export function createResolvedConfig(config: {
	root: string;
	mode: string;
	publicDir: string;
	logger: Logger;
	logLevel: ResolvedConfig["logLevel"];
}): ResolvedConfig {
	return fromPartial<ResolvedConfig>(config);
}

/**
 * Creates the Vite dev server that the internals read, backed by Rsbuild's.
 *
 * @param middlewares Rsbuild's middleware stack.
 * @param config The server settings.
 * @param logger The Vite logger.
 * @returns A partial Vite dev server.
 */
export function createDevServer(
	middlewares: (...args: never[]) => unknown,
	config: ServerConfig,
	logger: Logger
): ViteDevServer {
	return fromPartial<ViteDevServer>({
		config: { logger, server: toServerOptions(config) },
		middlewares: middlewares as unknown as ViteDevServer["middlewares"],
		// The Rsbuild bundles don't depend on workerd's state, so they don't need
		// re-creating when Miniflare restarts workerd.
		restart: async () => {},
	});
}

/**
 * Creates the Vite preview server that the internals read.
 *
 * @param config The server settings.
 * @param logger The Vite logger.
 * @returns A partial Vite preview server.
 */
export function createPreviewServer(
	config: ServerConfig,
	logger: Logger
): PreviewServer {
	return fromPartial<PreviewServer>({
		config: { logger, preview: toServerOptions(config) },
	});
}

/**
 * Converts the server settings to Vite's options. The internals only check
 * whether HTTPS is enabled, so its TLS options are left out.
 */
function toServerOptions({
	https,
	...config
}: ServerConfig): DeepPartial<ServerOptions> {
	return { ...config, https: https ? {} : undefined };
}

/**
 * Wraps Rsbuild's HTTP server for `handleWebSocket`, which forwards WebSockets
 * to the Workers. It only skips Vite's HMR and DevTools WebSockets, so this
 * hides Rsbuild's HMR WebSocket.
 *
 * @param httpServer Rsbuild's HTTP server.
 * @param hmrPath The path of Rsbuild's HMR WebSocket, if any.
 * @returns An HTTP server for `handleWebSocket`.
 */
export function toViteHttpServer(
	httpServer: Server | Http2SecureServer,
	hmrPath?: string
): HttpServer {
	const facade = new EventEmitter();
	httpServer.on("upgrade", (request: { url?: string }, ...args: unknown[]) => {
		const { pathname } = new URL(request.url ?? "/", "http://localhost");
		if (pathname !== hmrPath) {
			facade.emit("upgrade", request, ...args);
		}
	});
	return facade as unknown as HttpServer;
}
