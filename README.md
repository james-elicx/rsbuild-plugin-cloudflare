# rsbuild-plugin-cloudflare

An experimental [Rsbuild](https://rsbuild.rs) plugin that runs Cloudflare
Workers in workerd during `rsbuild dev` and `rsbuild preview`, and builds them
with `rsbuild build`.

The plugin is a thin wrapper over the internals of workers-sdk's
[`@cloudflare/vite-plugin`](https://github.com/cloudflare/workers-sdk/tree/main/packages/vite-plugin-cloudflare):
config resolution, Miniflare options, the asset and router Workers, Node.js
compatibility and build output all come from upstream. This repository holds
the Rsbuild glue, and runs the Vite plugin's own playground and e2e suites
against it.

See [`packages/rsbuild-plugin`](packages/rsbuild-plugin/README.md) for usage
and the differences from the Vite plugin.

## Layout

| Path                                    | What                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `workers-sdk/`                          | workers-sdk, as a pinned git submodule. Never edited directly.         |
| `patches/`                              | Small hooks applied to the submodule (see [UPSTREAM.md](UPSTREAM.md)). |
| `packages/rsbuild-plugin/`              | `rsbuild-plugin-cloudflare`.                                           |
| `packages/rsbuild-plugin/src/upstream/` | Code copied from workers-sdk, and the ledger that tracks it.           |
| `packages/test-harness/`                | Runs the Vite plugin's playground and e2e suites against Rsbuild.      |
| `packages/e2e/`                         | This repository's e2e tests: Playwright tests of real-world apps.      |
| `scripts/`                              | Submodule setup, bumping, and the upstream checks.                     |

## Getting started

Use the Node.js and pnpm versions in `package.json` (workers-sdk's).

```sh
git clone --recurse-submodules git@github.com:james-elicx/rsbuild-plugin-cloudflare.git
cd rsbuild-plugin-cloudflare
pnpm setup:upstream   # Apply patches/, then install and build workers-sdk
pnpm install
pnpm build
```

`pnpm setup:upstream` must run before `pnpm install`, as the plugin's
workers-sdk dependencies are linked to the submodule's packages.

## Commands

| Command                | What                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `pnpm build`           | Build the plugin.                                                            |
| `pnpm check`           | Upstream checks, lint (oxlint), format (oxfmt) and type checks.              |
| `pnpm fix`             | Apply lint and formatting fixes.                                             |
| `pnpm test`            | The plugin's unit tests.                                                     |
| `pnpm test:playground` | The Vite plugin's playground suite against Rsbuild, in serve and build mode. |
| `pnpm test:e2e`        | The Vite plugin's e2e suite against Rsbuild (needs npm, pnpm and yarn).      |
| `pnpm test:apps`       | Playwright tests of real-world apps (e.g. TanStack Start), dev and preview.  |

To run part of a suite, pass a filter, e.g.
`pnpm -F rsbuild-plugin-cloudflare-test-harness test:playground:serve assets`.
The playground suite needs Chromium:
`pnpm -F rsbuild-plugin-cloudflare-test-harness playwright:install`, as does
`pnpm test:apps`: `pnpm -F rsbuild-plugin-cloudflare-e2e playwright:install`
(see [`packages/e2e`](packages/e2e/README.md)).

## Staying in sync with workers-sdk

A daily workflow moves the submodule to workers-sdk's `main` and updates the
other dependencies in a pull request, runs CI, and rebase-merges the pull
request when it passes. See [UPSTREAM.md](UPSTREAM.md) for how it works and
what to do when it fails.

## Releases

Each push to `main` updates a "Version Packages" pull request with a patch
release whose notes are generated from the commit subjects since the last
release, plus the subjects of the workers-sdk commits that changed the Vite
plugin. Merging it publishes the release to npm. See
[.changeset/README.md](.changeset/README.md).
