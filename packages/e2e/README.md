# `rsbuild-plugin-cloudflare-e2e`

Playwright tests of real-world apps that use `rsbuild-plugin-cloudflare`, run
with `rsbuild dev`, and with `rsbuild preview` after `rsbuild build`. Unlike
`packages/test-harness`, which runs the Vite plugin's own suites against the
Rsbuild plugin, these tests are this repository's own.

## Apps

Each app in `fixtures/` is a workspace package, tested by
`tests/<name>.spec.ts`. The apps are kept as close as possible to the templates
that they come from, including their formatting, so they're excluded from this
repository's lint and format checks.

### `tanstack-start`

TanStack's official Rsbuild template,
[`examples/react/start-basic-rsbuild`](https://github.com/TanStack/router/tree/08a419c109ea2739fef0b893e09f4919fbd1b0d8/examples/react/start-basic-rsbuild)
from TanStack/router at `08a419c1`, with the changes from TanStack's
Cloudflare example
([`examples/react/start-basic-cloudflare`](https://github.com/TanStack/router/tree/08a419c109ea2739fef0b893e09f4919fbd1b0d8/examples/react/start-basic-cloudflare))
applied:

- `rsbuild.config.ts` adds `cloudflare({ rsbuildEnvironment: { name: "ssr" } })`
  before `tanstackStart()`.
- `cloudflare.config.ts` configures the Worker, as `wrangler.jsonc` does in the
  Cloudflare example: the Vite plugin, and so this plugin, no longer read
  Wrangler configuration files.
- `src/routes/index.tsx` reads `navigator.userAgent` and a `vars` binding in a
  server function, as in the Cloudflare example.
- `tsconfig.json` includes the generated `.cloudflare/types`, and
  `.gitignore` ignores `.cloudflare`.
- `package.json` depends on `rsbuild-plugin-cloudflare` and `cf`, drops the
  Node.js `start` script and `srvx`, and uses this repository's versions of
  TypeScript (5, rather than 6 and the native preview), `@types/node` and the
  Rsbuild packages.
- `README.md` describes the Cloudflare setup.

## Running the tests

```sh
pnpm build
pnpm -F rsbuild-plugin-cloudflare-e2e playwright:install
pnpm test:apps   # Or `pnpm -F rsbuild-plugin-cloudflare-e2e test:apps:dev`, or `test:apps:preview`
```

The tests start the apps' servers themselves (see `playwright.shared.ts`), on
fixed ports from 4310. Playwright options can be passed on, e.g.
`pnpm -F rsbuild-plugin-cloudflare-e2e test:apps:dev -g "hydrates"`.

## Adding an app

1. Copy the app's template into `fixtures/<name>`, and add the plugin with as
   few changes as possible. Record where it came from here.
2. Add it to `apps` in `playwright.shared.ts`, with its own port.
3. Add `tests/<name>.spec.ts`.
