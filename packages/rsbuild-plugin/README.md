# `@cloudflare/rsbuild-plugin`

An experimental [Rsbuild](https://rsbuild.rs) plugin for Cloudflare Workers. It
runs your Workers in workerd during `rsbuild dev` and `rsbuild preview`, and
builds them, with your client assets, during `rsbuild build`.

It's built on the internals of
[`@cloudflare/vite-plugin`](https://developers.cloudflare.com/workers/vite-plugin/),
and accepts the same options.

## Usage

```ts
// rsbuild.config.ts
import { pluginCloudflare } from "@cloudflare/rsbuild-plugin";
import { defineConfig } from "@rsbuild/core";

export default defineConfig({
	plugins: [pluginCloudflare()],
});
```

The Worker is configured in `cloudflare.config.ts`, as for the Vite plugin.

### Options

The options are those of the Vite plugin's `cloudflare()` (e.g. `config`,
`auxiliaryWorkers`, `persistState`, `inspectorPort`, `remoteBindings`), apart
from `tunnel`, plus:

- `envDir`: the directory to load `.env` and `.dev.vars` files from, or `false`
  to skip them. Defaults to the project root.
- `envMode`: the mode used to load `cloudflare.config.ts`, `.env.[mode]` and
  `.dev.vars.[mode]`. Defaults to Rsbuild's mode.

The entry Worker is built by an Rsbuild environment named `cloudflare`, unless
`viteEnvironment.name` is set. Auxiliary Workers' environments are named as in
the Vite plugin.

## Differences from the Vite plugin

The plugin replaces Vite's module runner with Rsbuild's bundles, so behaviour
that depends on how Vite works internally isn't available:

- Workers are rebuilt and reloaded when their code changes; there's no in-Worker
  HMR (`import.meta.hot`).
- Child environments, the hot channel, `bundledDev`, middleware mode, custom
  `buildApp`s and Vite plugins (e.g. for virtual modules) don't apply.
- Prerendering isn't supported, as Rsbuild has no equivalent of `buildApp`.
- Containers aren't supported yet: a warning is logged, and Container-backed
  Durable Objects fail.
- `tunnel` and the Vite CLI shortcuts aren't supported.

Other differences:

- Rsbuild serves `/` and `*.html` itself, so the plugin intercepts page
  navigations (`GET` and `HEAD` requests for `.html` paths or paths without an
  extension, apart from Rsbuild's HMR path and paths starting with `/__` or
  `/rsbuild-`) and sends them to the Workers. These requests reach the Workers
  before Rsbuild's `server.proxy`.
- When workerd restarts, the Vite plugin restarts the dev server; the Rsbuild
  bundles don't depend on workerd's state, so the plugin doesn't.
- No "Debug" URL is printed, but `/__debug` works.
- Miniflare's message about updating the compatibility date mentions
  `@cloudflare/vite-plugin`.
