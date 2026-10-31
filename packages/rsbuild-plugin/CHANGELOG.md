# rsbuild-plugin-cloudflare

## 0.0.3

### Patch Changes

- Keep remote bindings' proxy sessions running when the dev server restarts, as the Vite plugin does

### Upstream Changes (`@cloudflare/vite-plugin`)

- Treat cloudflare:durable-objects as a built-in module (cloudflare/workers-sdk#16452)
- Preserve Worker response statusText in dev and preview (cloudflare/workers-sdk#16453)
- Preserve repeated Set-Cookie request headers (cloudflare/workers-sdk#16486)
- Simplify WebSocket header forwarding (cloudflare/workers-sdk#16488)
- Clear Worker export types when the dev server closes (cloudflare/workers-sdk#16457)
- Use cf credentials for remote bindings (cloudflare/workers-sdk#16428)
- fix(vite-plugin): don't destroy WebSockets owned by other upgrade listeners (cloudflare/workers-sdk#15659)
- Route DevTools WebSocket upgrades explicitly (cloudflare/workers-sdk#16519)
- Close disabled HMR WebSocket upgrades (cloudflare/workers-sdk#15290)
- Support remote Analytics Engine bindings in local dev (cloudflare/workers-sdk#16536)
- Revert "Version Packages" (cloudflare/workers-sdk#16554)
- Customize the full parsed configuration (cloudflare/workers-sdk#16573)

## 0.0.2

### Patch Changes

- Require `@rsbuild/core` 2.2.10 or later, which builds Workers as ES modules (#38)
- Support React Server Components (#40)
- Document React Server Components and custom server entries with TanStack Start (#44)

## 0.0.1

### Patch Changes

- Print Worker-only dev server URLs once it listens
- Import upstream code directly and export helpers instead of copying them
- Rename the package to rsbuild-plugin-cloudflare and export cloudflare()
- Publish releases to npm with generated changesets
- Support frameworks that configure their server environment for Node.js, such as TanStack Start
- Run Workers in workerd when frameworks load them with loadBundle() in dev, so TanStack Start no longer needs its dev middleware turned off
- Rename the viteEnvironment option to rsbuildEnvironment
- Apply the config in a Worker's Rsbuild environment once, rather than running its functions and appending its arrays twice
- Fix assets that the Worker imports sometimes missing from the build
- Give assets that the Worker imports the same names as the client's, so pages no longer link a stylesheet twice in production
- Give Workers the preview server's actual URL when Rsbuild picks another port
- Forward WebSockets to the Worker in dev once it starts, even if its first start failed
- Always write Workers to their Build Output location, even when their environment sets output.distPath
- Warn that Containers aren't supported in builds and previews, as in dev
- Don't read \_headers and \_redirects from public/ when server.publicDir is false
- Reject a Worker environment named "web", which is Rsbuild's client environment
- Warn when a Worker's environment sets output.externals, which workerd can't import
- Replace process.env with an empty object in Workers without nodejs_compat
- Set import.meta.env.SSR to true in Workers
- Resolve the development or production export condition in Workers
- Resolve the same file extensions in Workers as the Vite plugin
- Skip the /\_\_debug page in VS Code JavaScript Debug terminals, and list no Workers on it for assets-only configs, like the Vite plugin
- Log how many imported assets were moved to the client build output, like the Vite plugin
- Resolve envDir with the Vite plugin's resolveEnvDir
- Document more differences from the Vite plugin
- Warn about Node.js imports in Workers without the `nodejs_compat` flag, instead of failing to resolve them
- Give Workers an empty default export when their entrypoint has none
- Stop emitting additional modules that a Worker no longer imports after a rebuild
- Fail the build when a Worker imports an unknown `cloudflare:` module, instead of at runtime
- Minify the CSS that Workers import as the client does, so that pages link one stylesheet whatever `output.minify` is
- Apply the top-level `output.sourceMap` setting to Workers
- Resolve Worker entrypoints with the environment's extensions and aliases, as the Vite plugin does
- Don't build a `devOnly` or `assetsOnly` Worker's Rsbuild environment as a client
- Fail the build when `assetsOnly` is set but no client is built, as the Vite plugin does
- Warn that Containers aren't supported once per dev server, rather than on every Worker reload
- Give Workers the server's URL from the start, rather than once the server listens
- Build and serve the client from Rsbuild's default entry (`src/index.*`) when `index.html` exists and the entry isn't a Worker's
- Document that the dev server also serves the Workers' build output
- Copy only the public assets, rather than building `src/index.*` as a client, when no client or Worker is built, as the Vite plugin does
- Fail an `assetsOnly` build when the public directory is empty, and don't fail it with a prerender Worker, as the Vite plugin does
- Don't build a Worker's entrypoint as the client when the Worker imports it without its extension
- Document that `rsbuild build` writes a Cloudflare Build Output that `cf deploy --prebuilt` can deploy (#26)
- Fix Workers failing to start in workerd when they import assets with `new URL(..., import.meta.url)`, as TanStack's devtools do
- Don't rebuild when Miniflare writes its state to `.cloudflare`, as the Vite plugin doesn't
- Document how to set up TanStack Start (#30)

### Upstream Changes (`@cloudflare/vite-plugin`)

- Record the Worker main module from the bundle (cloudflare/workers-sdk#16412)
