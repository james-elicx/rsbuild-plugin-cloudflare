import { afterEach, describe, test, vi } from "vitest";
import {
	build,
	copyFixture,
	startDevServer,
	startPreviewServer,
} from "./helpers";

afterEach(() => vi.unstubAllEnvs());

/**
 * Gets the status of a Local Explorer API request with an `Origin` header.
 *
 * @param url The server's URL.
 * @param hostname The origin's hostname.
 * @returns The response's status.
 */
async function getExplorerStatus(
	url: string,
	hostname: string
): Promise<number> {
	const response = await fetch(
		new URL("/cdn-cgi/local/explorer/api/storage/kv/namespaces", url),
		{ headers: { Origin: `https://${hostname}` } }
	);
	await response.arrayBuffer();
	return response.status;
}

describe("local-explorer", () => {
	test.for(
		(["dev", "preview"] as const).flatMap((mode) => [
			{
				mode,
				useAllowedHosts: undefined,
				allowedHosts: ["my-app.test", ".example.com"],
				configuredStatus: 403,
			},
			{
				mode,
				useAllowedHosts: "true",
				allowedHosts: ["my-app.test", ".example.com"],
				configuredStatus: 200,
			},
			{
				mode,
				useAllowedHosts: "true",
				allowedHosts: true as const,
				configuredStatus: 403,
			},
		])
	)(
		"trusts `server.allowedHosts` only when opted in, with %j",
		async (
			{ mode, useAllowedHosts, allowedHosts, configuredStatus },
			{ expect }
		) => {
			vi.stubEnv("X_LOCAL_EXPLORER", "true");
			vi.stubEnv("X_LOCAL_EXPLORER_USE_VITE_ALLOWED_HOSTS", useAllowedHosts);
			const root = copyFixture("worker");
			const config = { server: { allowedHosts } };
			let url: string;
			if (mode === "dev") {
				url = await startDevServer(root, config);
			} else {
				await build(root);
				url = await startPreviewServer(root, config);
			}

			for (const [hostname, status] of [
				["localhost:8787", 200],
				["my-app.test", configuredStatus],
				["sub.example.com", configuredStatus],
				["sub.my-app.test", 403],
				["evil.com", 403],
			] as const) {
				expect(await getExplorerStatus(url, hostname), hostname).toBe(status);
			}
		}
	);
});
