# `rsbuild-plugin-cloudflare`

An experimental [Rsbuild](https://rsbuild.rs) plugin for Cloudflare Workers. It
runs your Workers in workerd during `rsbuild dev` and `rsbuild preview`, and
builds them, with your client assets, during `rsbuild build`.

It's built on the internals of
[`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/),
and accepts the same options.

## Usage

```ts
// rsbuild.config.ts
import { cloudflare } from "rsbuild-plugin-cloudflare";
import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	plugins: [cloudflare()],
});
```

The Worker is configured in `cloudflare.config.ts`, as for the Vite plugin.

### Options

The options are those of the Vite plugin's `cloudflare()` (e.g. `config`,
`auxiliaryWorkers`, `persistState`, `inspectorPort`, `remoteBindings`), apart
from `tunnel`, and with `rsbuildEnvironment` in place of `viteEnvironment`
(see [Worker environments](#worker-environments)), plus:

- `envDir`: the directory to load `.env` and `.dev.vars` files from, or `false`
  to skip them. Defaults to the project root.
- `envMode`: the mode used to load `cloudflare.config.ts`, `.env.[mode]` and
  `.dev.vars.[mode]`. Defaults to Rsbuild's mode.

### Worker environments

Each Worker is built by an
[Rsbuild environment](https://rsbuild.rs/config/environments). The entry
Worker's is named `cloudflare`, unless `rsbuildEnvironment.name` is set.
Auxiliary Workers' are named as in the Vite plugin, unless their own
`rsbuildEnvironment.name` is set. `rsbuildEnvironment` replaces the Vite
plugin's `viteEnvironment`, without `childEnvironments`.

To change how a Worker is built, configure its environment in Rsbuild's
`environments` config. The plugin merges its settings in, and yours take
precedence, apart from `source.entry`, `output.target` and `output.module`,
which the plugin always sets so that the Worker runs in workerd, and
`output.distPath.root`, which it sets to the Worker's Build Output location, as
the Vite plugin does.

```ts
export default defineConfig({
	plugins: [cloudflare()],
	environments: {
		cloudflare: { output: { minify: true } },
	},
});
```

### Frameworks

As with the Vite plugin, put `cloudflare()` before the framework's plugins, and
set `rsbuildEnvironment.name` to the framework's server environment. The plugin
builds that environment for workerd, whatever target the framework sets.

In dev, the Worker environment's `loadBundle()` returns a module whose `fetch`
sends requests to the Worker in workerd, so frameworks that serve their server
bundle through `loadBundle()`, such as
[TanStack Start](https://tanstack.com/start), run it in workerd.

```ts
export default defineConfig({
	plugins: [
		pluginReact(),
		cloudflare({ rsbuildEnvironment: { name: "ssr" } }),
		tanstackStart(),
	],
});
```

See [`packages/e2e/fixtures/tanstack-start`](https://github.com/james-elicx/rsbuild-plugin-cloudflare/tree/main/packages/e2e/fixtures/tanstack-start) for
a complete app.

## Differences from the Vite plugin

The plugin replaces Vite's module runner with Rsbuild's bundles, so behaviour
that depends on how Vite works internally isn't available:

- Workers are rebuilt and reloaded when their code changes; there's no in-Worker
  HMR (`import.meta.hot`).
- Child environments, the hot channel, `bundledDev`, middleware mode, custom
  `buildApp`s and Vite plugins (e.g. for virtual modules) don't apply.
- Prerendering isn't supported, as Rsbuild has no equivalent of `buildApp`.
- Containers aren't supported yet: in dev and preview, a warning is logged and
  Container-backed Durable Objects fail; in a build, a warning is logged and no
  Container images or Container output are written.
- `tunnel` and the Vite CLI shortcuts aren't supported.

Other differences:

- Rsbuild serves `/` and `*.html` itself, so the plugin intercepts page
  navigations (`GET` and `HEAD` requests for `.html` paths or paths without an
  extension, apart from Rsbuild's HMR path and paths starting with `/__` or
  `/rsbuild-`) and sends them to the Workers. These requests reach the Workers
  before Rsbuild's `server.proxy`.
- When workerd restarts, the Vite plugin restarts the dev server; the Rsbuild
  bundles don't depend on workerd's state, so the plugin doesn't.
- Setting `output.externals` (other than Node.js built-ins) for a Worker's
  environment logs a warning, where the Vite plugin rejects `resolve.external`,
  as Rsbuild also applies top-level externals to every environment.
- No "Debug" URL is printed, but `/__debug` works.
- Miniflare's message about updating the compatibility date mentions
  `@cloudflare/vite-plugin`.
