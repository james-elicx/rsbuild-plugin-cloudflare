/**
 * TanStack's MSW handlers (`e2e/e2e-utils/src/api-handlers.ts`), which
 * `rsbuild.config.ts` aliases this module to. Only what `worker-api-mock.ts`
 * uses of MSW's `RequestHandler` is declared, as the checkout isn't there when
 * this package is type-checked.
 */
declare module "tanstack-e2e-api-handlers" {
	export const apiHandlers: Array<{
		run(args: {
			request: Request;
			requestId: string;
		}): Promise<{ response?: Response } | null>;
	}>;
}
