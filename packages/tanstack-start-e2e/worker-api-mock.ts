/**
 * Mocks the JSONPlaceholder API that the apps fetch from, inside the Worker.
 * TanStack's tests mock it with MSW in the app's Node.js server (by importing
 * `@tanstack/router-e2e-utils/mock-api`), which doesn't reach workerd, so this
 * module, which `rsbuild.config.ts` adds before the Worker's entry, passes the
 * Worker's requests to the same MSW handlers. A request that no handler
 * responds to is fetched as usual.
 */
import { apiHandlers } from "tanstack-e2e-api-handlers";

const fetchUnmocked = globalThis.fetch;

globalThis.fetch = async (input, init) => {
	const request = new Request(input, init);
	// As MSW's `getResponse()` does, which can't be imported here without
	// bundling a second copy of MSW alongside the handlers'.
	for (const handler of apiHandlers) {
		const result = await handler.run({
			request: request.clone(),
			requestId: crypto.randomUUID(),
		});
		if (result?.response !== undefined) {
			// `HttpResponse.error()`, which MSW turns into a network error.
			if (result.response.type === "error") {
				throw new TypeError("Failed to fetch");
			}
			return result.response;
		}
	}
	return fetchUnmocked(request);
};
