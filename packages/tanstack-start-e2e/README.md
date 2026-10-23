# `rsbuild-plugin-cloudflare-tanstack-start-e2e`

Runs [TanStack Start](https://tanstack.com/start)'s own e2e suites, the
Playwright tests of the apps in TanStack/router's
[`e2e/react-start`](https://github.com/TanStack/router/tree/main/e2e/react-start),
against the plugin, with `rsbuild dev`, and with `rsbuild preview` after
`rsbuild build`. As `packages/test-harness` does for workers-sdk's suites, it
runs them in TanStack's repository, which nothing is copied out of: this
package only holds wrappers for the apps' configs.

## How it works

- `scripts/setup.ts` checks out TanStack/router at the release pinned in
  `upstream.json`, into `tanstack-router/` at the repository root (which git
  ignores). It installs the apps' dependencies with TanStack's own pnpm and
  lockfile, and builds the TanStack packages that they use, so that the tests
  run against the code that they were written for.
- `scripts/test.ts` runs each app's tests from its directory, with its own
  Playwright and `playwright.config.ts`, wrapped by this package's
  `playwright.config.ts`. That serves the app with this package's
  `rsbuild.config.ts` instead of with Node.js, and skips the tests listed in
  `apps.ts`.
- `rsbuild.config.ts` loads the app's own `rsbuild.config.ts`, and adds the
  plugin as TanStack's Cloudflare example (`e2e/react-start/basic-cloudflare`)
  adds the Vite plugin, with the Worker configured inline rather than in a
  `cloudflare.config.ts`.
- `node-hooks.ts` resolves `@rsbuild/core` from this package for the app and
  TanStack's packages as well as for the plugin, because the plugin needs a
  newer version than TanStack's lockfile has.
- TanStack's tests mock the JSONPlaceholder API that the apps fetch from with
  MSW, in the app's Node.js server, which doesn't reach the Worker.
  `worker-api-mock.ts`, added before the Worker's entry, passes the Worker's
  requests to the same MSW handlers.

## Running the tests

```sh
pnpm build
pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e setup:tanstack-router
pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e playwright:install
pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e test:dev   # Or `test:preview`
```

`pnpm test:tanstack-start`, from the repository root, builds the plugin,
prepares the checkout and runs both modes. Apps and Playwright options can be
passed on, e.g.
`pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e test:dev basic -- -g "redirects"`.

## Updating TanStack/router

Set `tag` and `commit` in `upstream.json` to a newer
`@tanstack/react-start@<version>` release, and run `setup:tanstack-router`
again.

## Adding an app

Add it to `apps` in `apps.ts`, with the modes that it's tested in, and any
tests that it skips, with a reason. Only skip tests whose behaviour differs for
a reason unrelated to the plugin, e.g. because TanStack only runs them with
another toolchain or mode.
