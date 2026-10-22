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
  - `0005-vite-plugin-share-worker-environment-options.patch`: moves the
    Worker environments' export conditions, resolve extensions and
    `process.env` replacements to a module that doesn't import Vite, so that
    the plugin can import them.
  - `0006-vite-plugin-share-cloudflare-built-in-modules.patch`: moves
    `cloudflareBuiltInModules` to the same module, so that the plugin
    externalizes the same `cloudflare:` built-in modules.

  Keep them small, and propose them upstream where they make sense; each one
  that lands upstream can be deleted.

- **Imports:** the plugin imports the Vite plugin's internals straight from
  the submodule, so internal API changes surface as type errors.
- **`packages/rsbuild-plugin/src/upstream/`** holds only the code copied from
  upstream, where it's inlined in Vite hooks rather than exported.
  `upstream-copies.json` records a hash of each upstream declaration that a
  copy came from, and `pnpm check:copied-code` fails when one changes.
- **Mirrored declarations:** the plugin's own code reproduces some upstream
  declarations for Rsbuild instead of copying them.
  `scripts/upstream-mirrors.json` records their hashes in the same way, so
  `pnpm check:copied-code` also fails when one of them changes:

  | Upstream declaration                                                            | The plugin's counterpart                                                                                                                                |
  | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `cloudflare` (`index.ts`), which lists the sub-plugins                          | `cloudflare` (`index.ts`), which reproduces their hooks                                                                                                 |
  | `configPlugin` (`plugins/config.ts`)                                            | `modifyRsbuildConfig` and `modifyEnvironmentConfig` (`index.ts`)                                                                                        |
  | `getEnvironmentsConfig`, `forceBuildOutputDirs` (`plugins/config.ts`)           | The `environments` set in `modifyRsbuildConfig`, and the output directories set in `modifyEnvironmentConfig` (`index.ts`)                               |
  | `validateWorkerEnvironmentOptions` (`vite-config.ts`)                           | The `output.externals` warning in `modifyRsbuildConfig` (`index.ts`)                                                                                    |
  | `createCloudflareEnvironmentOptions` (`cloudflare-environment.ts`)              | `getWorkerEnvironmentConfig` (`worker-environment.ts`)                                                                                                  |
  | `getWorkerSourcemap` (`cloudflare-environment.ts`)                              | `output.sourceMap` in `getWorkerEnvironmentConfig` (`worker-environment.ts`)                                                                            |
  | `virtualModulesPlugin` (`plugins/virtual-modules.ts`)                           | `getWorkerEntry` (`worker-environment.ts`)                                                                                                              |
  | `additionalModulesPlugin` (`plugins/additional-modules.ts`)                     | The externals and `additionalModulesPlugin` (`worker-environment.ts`)                                                                                   |
  | `nodeJsAlsPlugin` (`plugins/nodejs-compat.ts`)                                  | The `isNodeAls` externals (`worker-environment.ts`)                                                                                                     |
  | `nodeJsCompatPlugin`, `nodeJsCompatWarningsPlugin` (`plugins/nodejs-compat.ts`) | The externals and `nodeJsCompatPlugin` (`worker-environment.ts`)                                                                                        |
  | `previewPlugin` (`plugins/preview.ts`)                                          | `server.setup`, which calls `setUpPreviewServer` (`index.ts`)                                                                                           |
  | `buildOutputPlugin` (`plugins/build-output.ts`)                                 | `onBeforeBuild`, `onAfterEnvironmentCompile` and `onAfterBuild` (`index.ts`)                                                                            |
  | `getHasPublicAssets`, `fallbackBuild`, `getImportedAssetPaths` (`build.ts`)     | The copy of the public directory in `onAfterBuild` (`index.ts`), and `getImportedAssetPaths` (`worker-environment.ts`)                                  |
  | `getDevMiniflareOptions` (`miniflare-options.ts`)                               | `getDevMiniflareOptions` (`miniflare-options.ts`), which removes the module runner's bindings from its result, and `createDevServer` (`vite-server.ts`) |
  | `getPreviewMiniflareOptions` (`miniflare-options.ts`)                           | `createPreviewServer` (`vite-server.ts`), which stands in for the Vite preview server that it reads                                                     |

  `devPlugin`, which also holds the static routing selection that
  `onBeforeStartDevServer` reproduces, and `createBuildApp` (`build.ts`) are
  already tracked as copies' sources.
  The hashes are of the patched submodule, as `pnpm setup:upstream` leaves it.

- **Dependencies:** `pnpm check:upstream-deps` checks that the plugin's runtime
  dependencies are the Vite plugin's, that the `overrides` in
  `pnpm-workspace.yaml` link them to the submodule, and that the tooling,
  Node.js and pnpm versions (including CI's Node.js version) are
  workers-sdk's.
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
   commits in the message. If a sync pull request is already open, the branch
   is first rebased onto `main`, so that fixes pushed to it are kept.
3. `scripts/update-deps.ts` updates the dependencies that don't follow
   workers-sdk (those with `^` or `~` ranges) within their ranges, refreshes the
   lockfile, and commits that as "Update dependencies". Newer versions outside
   the ranges are listed in the pull request, to update by hand.
4. The branch is pushed to a pull request to `main`.
5. CI (`ci.yml`) runs against the pushed commit: checks, unit tests, the
   playground suite (serve and build) and the e2e suite.
6. When CI passes, the pull request is rebase-merged into `main`. Otherwise a
   comment on the pull request links to the failed run, and the pull request
   stays open for fixes.

Each upstream commit that the sync brings in and that changes the Vite plugin
(other than its tests) becomes a release note in the next release (see
[.changeset/README.md](.changeset/README.md)).

Dependabot updates the pinned GitHub Actions weekly (`.github/dependabot.yml`).

The workflow opens the pull request with `GITHUB_TOKEN`, so the repository must
allow it: enable **Settings → Actions → General → Allow GitHub Actions to create
and approve pull requests**. Pull requests opened with `GITHUB_TOKEN` don't
trigger other workflows, which is why the sync workflow runs `ci.yml` itself.

## Fixing a failed sync

```sh
git fetch origin
git checkout upstream-sync   # The sync pull request's branch
pnpm setup:upstream && pnpm install && pnpm build
pnpm check && pnpm test && pnpm test:playground && pnpm test:e2e
```

Then, depending on what failed:

- **A patch no longer applies:** fix the change in the submodule, regenerate
  the patch with `git -C workers-sdk diff -- <files> > patches/<name>.patch`,
  then revert the submodule's working tree with
  `./scripts/apply-patches.sh --reverse`.
- **`check:copied-code`:** review the upstream change to each listed
  declaration, update `src/upstream/copied.ts` to match (or, for a mirrored
  declaration, the plugin's counterpart in the table above), then run
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

Push the fixes to `upstream-sync`. The next sync (or a manual run of the
workflow) rebases them onto `main`, runs CI, and merges the pull request when it
passes. If the branch no longer rebases cleanly, rebase it onto `main` yourself
and force-push it.

Passing CI doesn't mean the plugin still behaves like the Vite plugin: only
the copied and mirrored declarations are checked mechanically, and only for
changes. To review the rest against an upstream change, follow the
`check-upstream-alignment` skill
(`.claude/skills/check-upstream-alignment/SKILL.md`).

If a fix would make the Rsbuild glue grow substantially, stop and reassess: the
plugin is meant to stay a thin wrapper over upstream, so the better fix may be
an upstream change that exposes what the plugin needs.
