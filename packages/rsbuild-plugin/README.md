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
- Uncaught errors in the entry Worker aren't returned to the dev server with
  the `MF-Experimental-Error-Stack` header, as the Vite plugin's module runner
  does, so there's no error overlay or source-mapped stack: the browser gets a
  plain-text `500` response.
- Child environments, the hot channel, `bundledDev`, middleware mode, custom
  `buildApp`s and Vite plugins (e.g. for virtual modules) don't apply.
- Prerendering isn't supported, as Rsbuild has no equivalent of `buildApp`. The
  prerender Worker is still built and written to the Build Output.
- Containers aren't supported yet: in dev and preview, a warning is logged and
  Container-backed Durable Objects fail; in a build, a warning is logged and no
  Container images or Container output are written.
- `tunnel` and the Vite CLI shortcuts aren't supported.
- The Local Explorer hint that the Vite plugin prints for AI agents isn't
  printed.

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
- Config changes (e.g. to `cloudflare.config.ts` or `.dev.vars`) restart
  Rsbuild's dev server, which closes the old server first: a broken config
  leaves no server running, whereas the Vite plugin keeps the old one. Miniflare
  is recreated rather than updated.
- The Rsbuild CLI loads `.env`, `.env.local`, `.env.[mode]` and
  `.env.[mode].local` into `process.env`, using its own env mode and directory
  rather than `envMode` and `envDir`. `process.env` takes precedence over the
  plugin's `.env` files, so these values override the Worker's `.env` values. A
  `.dev.vars` file is used on its own, so it isn't affected.
- The top-level `output.minify` setting for JavaScript, and the top-level
  `resolve.extensions`, `resolve.conditionNames` and `resolve.mainFields`, don't
  apply to Workers: the plugin sets these for the Worker environments, and
  Rsbuild uses an environment's settings over the top-level ones. Set them in
  `environments.<name>` instead. The top-level `output.sourceMap`, and the
  `output.minify` setting for CSS, do apply.
- Without `source.entry` or client environments, a client is built from
  Rsbuild's default entry (`src/index.*`) only when `index.html` exists at the
  project root, where Vite builds one whenever `index.html` exists. The default
  entry mustn't be a Worker's entrypoint. Rsbuild doesn't use that `index.html`
  as the page's template unless `html.template` is set to it.
- `devOnly` and `assetsOnly` functions are called when the config is resolved,
  to choose the Worker environments to build, rather than lazily at build time.
- Additional modules (e.g. `.wasm` and `.txt` imports) are emitted at the root
  of the Worker's output directory, with hashed names, rather than in `assets/`.
- SWC lowers `using` declarations in the Worker build, which Vite keeps.
- No "Debug" URL is printed, but `/__debug` works.
- Miniflare's message about updating the compatibility date mentions
  `@cloudflare/vite-plugin`.
