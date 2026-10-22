import stylesheet from "../src/style.css?url";

// Workers without `nodejs_compat` have no `process`, but the plugin replaces
// `process.env` with an empty object, as the Vite plugin does.
declare const process: { env: Record<string, string | undefined> };

interface Env {
	ASSETS: Fetcher;
}

export default {
	async fetch(request, env) {
		const { pathname } = new URL(request.url);

		if (pathname === "/api/env") {
			return new Response(String(process.env.UNDEFINED_VARIABLE));
		}

		// Server-rendered pages link the client's stylesheet.
		if (pathname === "/api/stylesheet") {
			return new Response(stylesheet);
		}

		if (pathname === "/api/hello") {
			return Response.json({ name: "Cloudflare" });
		}

		const response = await env.ASSETS.fetch(
			new URL("/index.html", request.url)
		);
		return new Response(response.body, {
			headers: { "content-type": "text/html", "x-from-worker": "true" },
		});
	},
} satisfies ExportedHandler<Env>;
