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
    Worker environments' export conditions (`defaultConditions`), resolve
    extensions (`resolveExtensions`), `process.env` replacements
    (`getProcessEnvReplacements`) and `cloudflare:` built-in modules
    (`cloudflareBuiltInModules`) to a module that doesn't import Vite
    (`worker-environment-options.ts`), so that the plugin resolves, defines
    and externalizes the same way as the Vite plugin.

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
  | `configPlugin` (`plugins/config.ts`)                                            | `modifyRsbuildConfig`, `modifyEnvironmentConfig` and `onBeforeBuild` (`index.ts`)                                                                       |
  | `getEnvironmentsConfig`, `getEnvironmentBuildOutputDir` (`plugins/config.ts`)   | The `environments` set in `modifyRsbuildConfig`, and the output directories set in `modifyEnvironmentConfig` (`index.ts`)                               |
  | `validateWorkerEnvironmentOptions` (`vite-config.ts`)                           | The `output.externals` warning in `modifyRsbuildConfig` (`index.ts`)                                                                                    |
  | `createCloudflareEnvironmentOptions` (`cloudflare-environment.ts`)              | `getWorkerEnvironmentConfig` (`worker-environment.ts`)                                                                                                  |
  | `getWorkerSourcemap` (`cloudflare-environment.ts`)                              | `output.sourceMap` in `getWorkerEnvironmentConfig` (`worker-environment.ts`)                                                                            |
  | `virtualModulesPlugin` (`plugins/virtual-modules.ts`)                           | `getWorkerEntry` (`worker-environment.ts`)                                                                                                              |
  | `additionalModulesPlugin` (`plugins/additional-modules.ts`)                     | The externals and `additionalModulesPlugin` (`worker-environment.ts`)                                                                                   |
  | `nodeJsAlsPlugin` (`plugins/nodejs-compat.ts`)                                  | The `isNodeAls` externals (`worker-environment.ts`)                                                                                                     |
  | `nodeJsCompatPlugin`, `nodeJsCompatWarningsPlugin` (`plugins/nodejs-compat.ts`) | The externals and `nodeJsCompatPlugin` (`worker-environment.ts`)                                                                                        |
  | `previewPlugin` (`plugins/preview.ts`)                                          | `server.setup`, which calls `setUpPreviewServer` (`index.ts`)                                                                                           |
  | `buildOutputPlugin` (`plugins/build-output.ts`)                                 | `onAfterEnvironmentCompile` and `onAfterBuild` (`index.ts`), and `getImportedAssetPaths` (`worker-environment.ts`)                                      |
  | `getHasPublicAssets`, `fallbackBuild` (`build.ts`)                              | `getFallbackClientConfig`, `getHasPublicAssets` and `onAfterBuild` (`index.ts`)                                                                         |
  | `getDevMiniflareOptions` (`miniflare-options.ts`)                               | `getDevMiniflareOptions` (`miniflare-options.ts`), which removes the module runner's bindings from its result, and `createDevServer` (`vite-server.ts`) |
  | `getPreviewMiniflareOptions` (`miniflare-options.ts`)                           | `createPreviewServer` (`vite-server.ts`), which stands in for the Vite preview server that it reads                                                     |

  `devPlugin`, which also holds the static routing selection that
  `onBeforeStartDevServer` reproduces, and `buildApp` (`build.ts`) are
  already tracked as copies' sources.
  The hashes are of the patched submodule, as `pnpm setup:upstream` leaves it.

- **Dependencies:** `pnpm check:upstream-deps` checks that the plugin's runtime
  dependencies are the Vite plugin's, that the `overrides` in
  `pnpm-workspace.yaml` link them to the submodule, and that the tooling,
  Node.js and pnpm versions (including CI's Node.js version) are
  workers-sdk's.
- **Skip lists:** `packages/test-harness/vitest.playground.config.ts` and
  `vitest.e2e.config.ts` skip the upstream tests of Vite-specific behaviour
  and of features that the plugin doesn't support yet, each with a reason.

## The daily sync

An [Alcora](https://alcora.dev) workflow, **Upstream sync**, syncs the
repository with workers-sdk in a sandbox. Its packages are in
[`.alcora/`](.alcora): the workflow (`upstream-sync`), the skill that syncs
(`check-upstream-alignment`, whose `SKILL.md` is the Claude Code skill's) and
one that finds the sync's pull request (`find-upstream-sync-pr`). Each sync
bumps workers-sdk, then aligns the plugin with upstream's changes, so it
leaves the repository up to date with upstream, not only bumped:

1. Every day at 14:00 UTC, or on **Sync now** (for testing; unlike the old
   Actions workflow, it takes no workers-sdk ref: a sync always moves to
   upstream's `main`), it looks for the open pull request from a branch
   `alcora/<run>/<step>/upstream-sync`.
2. With none open, a sandbox starts from the project's snapshot, branches from
   `main` and runs `scripts/bump-upstream.sh origin/main`, which reverts the
   patches, moves workers-sdk to upstream's `main`, re-applies the patches,
   installs and builds workers-sdk, and syncs the plugin's dependencies. That's
   committed as "Bump workers-sdk to …", with the upstream commits in the
   message. `scripts/update-deps.ts` then updates the dependencies that don't
   follow workers-sdk within their ranges, as "Update dependencies".
3. An agent finishes the bump if it failed (e.g. a patch no longer applies),
   follows the `check-upstream-alignment` skill on upstream's changes and
   applies its fixes, until `pnpm check`, the build, the unit tests and the
   affected playground and e2e specs pass. It commits as a person would, with
   subjects that are release notes, and leaves failures that Rsbuild or Rspack
   cause failing, saying so.
4. The branch is pushed to a pull request to `main`, which lists the
   plugin's changes, upstream's commits, the dependency updates and newer
   versions outside their ranges, to update by hand. The sandbox is kept.
5. With a pull request open, the sync continues its sandbox instead: it
   rebases the branch onto `main`, keeping fixes pushed to it (an agent
   resolves conflicts), bumps again, and aligns with the new changes.
6. Ready, the pull request is labelled `sync: merge on green`. Needing a
   person, it's left open with a comment saying why. Up to date or only
   rebased, it gets the label back only if it had it. If it merged or closed
   while the sync waited for its sandbox, the sync does nothing.
7. When CI (`ci.yml`) fails on the pull request's head, the agent continues
   the sandbox to fix it, or answers that the failures are flaky, and the
   workflow re-runs them (twice at most). After 20 rounds, it stops and says
   so.
8. `.github/workflows/merge-upstream-sync.yml` rebase-merges the labelled pull
   request once CI passes on its head, then dispatches `publish.yml`. Alcora
   doesn't merge pull requests, so that's the one part left in GitHub Actions.
   The workflow removes the label before each round that may push, so an
   unfinished head isn't merged.

Each upstream commit that the sync brings in and that changes the Vite plugin
(other than its tests) becomes a release note in the next release (see
[.changeset/README.md](.changeset/README.md)), as do the agent's commits.

Dependabot updates the pinned GitHub Actions weekly (`.github/dependabot.yml`).

### workers-sdk in the sandbox

Alcora's sandboxes clone the repository without its submodules, so
`scripts/fetch-upstream.sh` lays `workers-sdk/` out from GitHub's archive of
the pinned commit instead, as a git repository of its own whose commits are
the archives' trees (`cloudflare/workers-sdk@<sha>`). `bump-upstream.sh` and
`setup-upstream.sh` use it there, and the submodule elsewhere. The outer
repository's `workers-sdk` entry is marked `--skip-worktree`, so `git add` and
`git commit -a` never pin the layout's own commits; `fetch-upstream.sh <ref>`
sets the pin. The sync refuses to push a commit that pins one anyway.

### Turning it on

In an Alcora project for this repository, as an admin:

1. **Add the registry source:** on the **Workflow registry**, under
   **Add or import → Registry sources**, add
   `https://github.com/james-elicx/rsbuild-plugin-cloudflare`, branch `main`,
   folder `.alcora`.
2. **Add the setup commands** under **Settings → Environment**:

   ```sh
   ./scripts/fetch-upstream.sh && pnpm setup:upstream && pnpm install --frozen-lockfile
   ```

3. **Install the Sandbox snapshot workflow** (`alcora/sandbox-snapshot`) and
   turn it on, adding `patches/**` and `scripts/*upstream*` to the files it
   hashes, since workers-sdk's setup takes a while.
4. **Install Upstream sync** (`rsbuild-plugin-cloudflare/upstream-sync`) from
   the registry source, which brings its skills. Grant the Alcora GitHub App
   the Actions permission (read for the CI filter, read and write for
   re-runs). Installed workflows start off: try it with **Test run**, then
   turn it on.
5. On GitHub, close the Actions sync's pull request from `upstream-sync`, if
   one is open, and delete the branch: the new sync only looks for
   `alcora/*/upstream-sync`. Create the `sync: merge on green` label, and keep `main`'s
   ruleset requiring CI's checks, which `merge-upstream-sync.yml` merges
   after, with `GITHUB_TOKEN`: the ruleset mustn't require a review of these
   pull requests, or must let GitHub Actions bypass it.

**Model**, **Effort**, **Instance** and the time are settings of the
workflow. Raising a package's `version` releases it; installed workflows offer
the update.

## Fixing a sync that needs a person

The comment on the pull request says what the agent couldn't do. Check out
its branch:

```sh
git fetch origin
git checkout alcora/<run>/<step>/upstream-sync   # The sync pull request's branch
git submodule update --init
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
  it to the skip list with a reason. If Rsbuild or Rspack causes it, leave it
  failing and report it there. Otherwise fix the plugin.
- **`check:upstream-deps`:** run
  `node --experimental-strip-types scripts/sync-upstream-deps.ts`, then
  `pnpm install`.

Push the fixes to the branch, and add the `sync: merge on green` label once
CI passes, or leave it for the next sync: it rebases them onto `main` and
keeps them. To start afresh, close the pull request; the next sync opens
another. If CI fails on your fixes, the workflow's agent tries to fix them too.

Passing CI doesn't mean the plugin still behaves like the Vite plugin: only
the copied and mirrored declarations are checked mechanically, and only for
changes. To review the rest against an upstream change, follow the
`check-upstream-alignment` skill
(`.alcora/check-upstream-alignment/SKILL.md`, which
`.claude/skills/check-upstream-alignment/SKILL.md` links to). The daily sync
does that for each upstream change.

If a fix would make the Rsbuild glue grow substantially, stop and reassess: the
plugin is meant to stay a thin wrapper over upstream, so the better fix may be
an upstream change that exposes what the plugin needs.
