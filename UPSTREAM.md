# Keeping up with workers-sdk

The plugin reuses the Vite plugin's internals from the `workers-sdk` submodule,
so each workers-sdk change can affect it. This file describes how the
repository stays in sync, and what to do when a sync fails.

## What ties this repository to upstream

- **The submodule pointer** is the pinned workers-sdk commit. The plugin bundles
  sources from it, and links its runtime dependencies to its packages.
- **`patches/`** are small, behaviour-neutral hooks applied to the submodule,
  so that the plugin can reuse upstream code and the upstream suites can run
  against Rsbuild without forking them:
  - `0001-vite-plugin-expose-plugin-config.patch`: exposes the `cloudflare()`
    options on the Vite plugin (`api.pluginConfig`), which the playground
    harness passes to the Rsbuild plugin.
  - `0002-playground-pluggable-serve.patch`: lets the playground setup serve
    each playground with another module
    (`CLOUDFLARE_VITE_PLAYGROUND_SERVE_MODULE`).
  - `0003-e2e-seed-hook.patch`: lets the e2e helpers convert each seeded
    project (`CLOUDFLARE_VITE_E2E_SEED_MODULE`).
  - `0004-vite-plugin-export-internals.patch`: exports the additional-module
    helpers and `wasmInitRE`, which the plugin imports instead of copying.

  Keep them small, and propose them upstream where they make sense; each one
  that lands upstream can be deleted.

- **Imports:** the plugin imports the Vite plugin's internals straight from
  the submodule, so internal API changes surface as type errors.
- **`packages/rsbuild-plugin/src/upstream/`** holds only the code copied from
  upstream, where it's inlined in Vite hooks rather than exported.
  `upstream-copies.json` records a hash of each upstream declaration that a
  copy came from, and `pnpm check:copied-code` fails when one changes.
- **Dependencies:** `pnpm check:upstream-deps` checks that the plugin's runtime
  dependencies are the Vite plugin's, that the `overrides` in
  `pnpm-workspace.yaml` link them to the submodule, and that the tooling,
  Node.js and pnpm versions are workers-sdk's.
- **Skip lists:** `packages/test-harness/vitest.playground.config.ts` and
  `vitest.e2e.config.ts` skip the upstream tests of Vite-specific behaviour,
  each with a reason.

## The daily sync

`.github/workflows/sync-upstream.yml` runs daily, and on demand with an
optional ref:

1. `scripts/bump-upstream.sh` reverts the patches, moves the submodule to
   `origin/main`, re-applies the patches, installs and builds workers-sdk, and
   syncs the plugin's dependencies.
2. The bump is committed to the `upstream-sync` branch, with the upstream
   commits in the message, and CI (`ci.yml`) runs against it: checks, unit
   tests, the playground suite (serve and build) and the e2e suite.
3. When CI passes, `upstream-sync` is fast-forwarded onto `main`. Otherwise an
   issue labelled `upstream-sync` links to the failed run (and later failures
   comment on it). The issue is closed by the next successful sync.

The workflow pushes with `GITHUB_TOKEN`, so `main` must allow pushes from
GitHub Actions.

## Fixing a failed sync

```sh
git fetch origin
git checkout upstream-sync   # Or bump locally: ./scripts/bump-upstream.sh
pnpm setup:upstream && pnpm install && pnpm build
pnpm check && pnpm test && pnpm test:playground && pnpm test:e2e
```

Then, depending on what failed:

- **A patch no longer applies:** fix the change in the submodule, regenerate
  the patch with `git -C workers-sdk diff -- <files> > patches/<name>.patch`,
  then revert the submodule's working tree with
  `./scripts/apply-patches.sh --reverse`.
- **`check:copied-code`:** review the upstream change to each listed
  declaration, update `src/upstream/copied.ts` to match, then run
  `pnpm check:copied-code --update`. Better still, if upstream now exports it,
  import it instead and drop the copy.
- **Type errors:** an internal API changed. Adapt the adapters
  (`src/vite-server.ts`, `src/miniflare-options.ts`) rather than the Rsbuild
  glue where possible.
- **A playground or e2e test fails:** if it tests Vite-specific behaviour, add
  it to the skip list with a reason. Otherwise fix the plugin.
- **`check:upstream-deps`:** run
  `node --experimental-strip-types scripts/sync-upstream-deps.ts`, then
  `pnpm install`.

Push the fixes to `upstream-sync`, open a pull request to `main`, and merge it
once CI passes.

If a fix would make the Rsbuild glue grow substantially, stop and reassess: the
plugin is meant to stay a thin wrapper over upstream, so the better fix may be
an upstream change that exposes what the plugin needs.
