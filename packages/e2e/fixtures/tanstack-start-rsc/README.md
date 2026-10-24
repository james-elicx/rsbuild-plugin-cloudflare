# TanStack Start - Basic Rsbuild Example with React Server Components on Cloudflare Workers

This is the basic TanStack Start Rsbuild example, demonstrating the fundamentals of building applications with TanStack Router and TanStack Start, running on Cloudflare Workers with [`rsbuild-plugin-cloudflare`](../../../rsbuild-plugin), with [React Server Components](https://tanstack.com/start/latest/docs/framework/react/guide/server-components) enabled.

- [TanStack Router Docs](https://tanstack.com/router)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

It's based on TanStack's [`start-basic-rsbuild`](https://github.com/TanStack/router/tree/main/examples/react/start-basic-rsbuild) and [`start-basic-cloudflare`](https://github.com/TanStack/router/tree/main/examples/react/start-basic-cloudflare) examples.

## Getting Started

From your terminal:

```sh
pnpm install
pnpm dev
```

This starts your app in development mode, running it in workerd and rebuilding assets on file changes.

## Build

To build the app for production:

```sh
pnpm build
```

## Preview

To preview the production build locally, in workerd:

```sh
pnpm preview
```

## Accessing Cloudflare Bindings

You can access Cloudflare bindings in server functions by using importable `env`:

```ts
import { env } from 'cloudflare:workers'
```

See `src/routes/index.tsx` for an example.

## React Server Components

React Server Components are enabled with `rsc: { enabled: true }` in `rsbuild.config.ts`, which needs `react-server-dom-rspack` as a dependency. See `src/routes/rsc.tsx` for a server component, and a composite component with a slot, that render client components (`src/components/Counter.tsx`) in the Worker.

## Cloudflare Configuration

The Worker is configured in `cloudflare.config.ts`. Its types are generated to `.cloudflare/types` when the app starts or builds.
