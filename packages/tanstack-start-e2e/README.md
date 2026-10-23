# `rsbuild-plugin-cloudflare-tanstack-start-e2e`

Runs [TanStack Start](https://tanstack.com/start)'s own e2e suites, the
Playwright tests of the apps in TanStack/router's
[`e2e/react-start`](https://github.com/TanStack/router/tree/main/e2e/react-start),
against the plugin, with `rsbuild dev`, or with `rsbuild preview` after
`rsbuild build`. As `packages/test-harness` does for workers-sdk's suites, it
runs them in TanStack's repository, which nothing is copied out of: this
package only holds wrappers for the apps' configs.

## How it works

- `scripts/setup.ts` checks out TanStack/router at the release pinned in
  `upstream.json`, into `tanstack-router/` at the repository root (which git
  ignores). It installs the apps' dependencies with TanStack's own pnpm and
  lockfile, and builds the TanStack packages that they use, so that the tests
  run against the code that they were written for.
- `scripts/test.ts` runs the suites in `apps.ts`: TanStack's Rsbuild runs of
  each app (its `package.json`'s `nx.metadata.playwrightModes`), and `basic`'s
  tests in dev, with the same
  `MODE` and variables. It runs an app's tests from its directory, with
  TanStack's Playwright and the app's `playwright.config.ts`, wrapped by this
  package's `playwright.config.ts`. That serves the app with this package's
  `rsbuild.config.ts` instead of with Node.js, and skips the tests listed in
  `apps.ts`.
- `rsbuild.config.ts` loads the app's own `rsbuild.config.ts`, and adds the
  plugin as its README describes. The Worker is configured in this package's
  `cloudflare.config.ts`, which `scripts/test.ts` re-exports from a
  `cloudflare.config.ts` in the app's directory: TanStack's Cloudflare example's
  config (`e2e/react-start/basic-cloudflare`), with the suite's entrypoint, for
  apps with their own server entry, and its variables, which some apps read at
  runtime.
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
pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e test:tanstack-start
```

`pnpm test:tanstack-start`, from the repository root, builds the plugin,
prepares the checkout and runs every suite. `setup:tanstack-router` can be given
apps to prepare only those. `test:tanstack-start` can be given suites, by ID
(e.g. `basic:preview:iife`) or by the start of one (e.g. `basic`), and passes on
Playwright options after `--`, e.g.
`pnpm -F rsbuild-plugin-cloudflare-tanstack-start-e2e test:tanstack-start basic:dev -- -g "redirects"`.
`test:dev` and `test:preview` run only the suites served by `rsbuild dev` or
by `rsbuild preview`.

CI runs each app's suites in its own job. `scripts/list-apps.ts` lists the
apps for its matrix.

## Updating TanStack/router

Set `tag` and `commit` in `upstream.json` to a newer
`@tanstack/react-start@<version>` release, and run `setup:tanstack-router`
again.

## Adding an app

Add it to `apps` in `apps.ts`, with its suites, and any tests that they skip,
with a reason. Only skip tests whose behaviour differs for a reason unrelated to
the plugin (e.g. because they need the Node.js runtime, or because the Vite
plugin behaves the same way), or that test features that the plugin's README
lists as unsupported. The apps that aren't included, and why, are listed above
`apps`.
