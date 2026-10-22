---
name: check-upstream-alignment
description: Review whether the Rsbuild plugin's own code (everything outside src/upstream/) still behaves like workers-sdk's Vite plugin, and report undocumented divergences. Use after the workers-sdk submodule moves, before a release, after changing the plugin's glue or adapters, or when asked whether the plugin matches the Vite plugin.
---

# Check the Rsbuild plugin's alignment with the Vite plugin

`rsbuild-plugin-cloudflare` must behave like `@cloudflare/vite-plugin` wherever
the bundlers allow it. Code copied from upstream is already checked
mechanically: `pnpm check:copied-code` fails when an upstream declaration that
`src/upstream/copied.ts` came from changes. It also fails when one of the
upstream declarations listed in `scripts/upstream-mirrors.json` changes: these
are the ones that the plugin's own code reproduces (see the table in
`UPSTREAM.md`). That only says that a declaration changed, not whether the
plugin still matches it. Nothing else checks the rest of the plugin (the
Rsbuild glue and the adapters), which reproduces what the Vite plugin does in
Vite hooks. This skill reviews that code against upstream and reports where it
has drifted.

Read `AGENTS.md`, `UPSTREAM.md`, and `packages/rsbuild-plugin/README.md`
("Differences from the Vite plugin") first. The README lists the intentional
differences. The skip lists in `packages/test-harness/vitest.playground.config.ts`
and `vitest.e2e.config.ts` list the upstream tests that don't apply, with
reasons.

## Scope

- **Reviewed:** `packages/rsbuild-plugin/src/**` apart from `src/upstream/` and
  `__tests__/`, which today means:
  - `index.ts` (the Rsbuild hooks);
  - `worker-environment.ts` (the Worker environments' Rspack config and plugins);
  - `miniflare-options.ts`, `vite-server.ts` and `vite-shim.ts` (the adapters
    that let upstream's internals run under Rsbuild);
  - `patches/`, the changes applied to the submodule.
- **The reference:** `workers-sdk/packages/vite-plugin-cloudflare/src`, at the
  pinned submodule commit.
- **Not reviewed:** `src/upstream/` (use `pnpm check:copied-code`) and behaviour
  that the README already lists as unsupported.

When asked about a range of upstream changes (e.g. after a sync), focus on the
upstream files that changed:
`git -C workers-sdk diff --stat <old>..<new> -- packages/vite-plugin-cloudflare/src`.
`git log -p -- workers-sdk` shows the previous submodule commits. Still check
the whole plugin when the user asks for a full review.

## Procedure

1. **Map upstream's behaviour.** Start from `createPlugin` in upstream's
   `src/index.ts`, which lists the sub-plugins (`configPlugin`, `devPlugin`,
   `previewPlugin`, `buildOutputPlugin`, `additionalModulesPlugin`,
   `nodeJsCompatPlugin`...). For each sub-plugin in `src/plugins/`, list what
   each hook does: the config it sets, the middleware it adds and in which
   order, the files it writes, the options it reads, and the messages it logs.
2. **Find each behaviour's counterpart in the plugin.** The usual counterparts
   are:

   | Upstream (Vite)                                                         | Rsbuild plugin                                                                                    |
   | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
   | `config`, `configEnvironment`, `configResolved`                         | `modifyRsbuildConfig`, `modifyEnvironmentConfig`, `getWorkerEnvironmentConfig`                    |
   | `configureServer` (`devPlugin`, `debugPlugin`, `triggerHandlersPlugin`) | `onBeforeStartDevServer` (middleware before Rsbuild's) and its returned callback (after)          |
   | `configurePreviewServer` (`previewPlugin`)                              | `server.setup`, which calls `setUpPreviewServer` (middleware before Rsbuild's and later plugins') |
   | `resolveId`, `load`, `transform`, `renderChunk`                         | Rspack rules, externals and plugins in `worker-environment.ts`                                    |
   | `buildApp`, `writeBundle` (`buildOutputPlugin`)                         | `onAfterEnvironmentCompile`, `onAfterBuild`                                                       |
   | `hotUpdate`                                                             | `onAfterDevCompile` (Workers are reloaded, not hot-updated)                                       |

   Each behaviour gets one of these statuses:
   - **aligned:** the plugin gets the same result, ideally by calling the same
     upstream function;
   - **documented:** it differs, and the README or a skip list says so and why;
   - **undocumented divergence:** it differs, and nothing says so;
   - **missing:** the plugin doesn't do it, and nothing says so.

3. **Check the adapters' contracts.**
   - `vite-server.ts` and `vite-shim.ts` stand in for the Vite objects that
     upstream code receives. Grep upstream for every property and method it
     uses on those objects, e.g. the `viteDevServer.`, `config.` and
     `environment.` accesses in the functions the plugin calls. Confirm that
     the adapters provide each one with the same meaning. A property that
     upstream started reading and the adapter doesn't set is a silent
     divergence.
   - `miniflare-options.ts` must only post-process upstream's
     `getDevMiniflareOptions` result for Rsbuild. Diff the options that it
     changes against what upstream sets, and check each change is still needed.
4. **Look for re-implemented upstream logic.** Flag code in the plugin that
   reproduces a top-level upstream function instead of importing it, as it
   will drift silently. The fix is to import it, or export it with a patch like
   `patches/0004-vite-plugin-export-internals.patch`. Copy it into
   `src/upstream/copied.ts` (recording it in `upstream-copies.json`) only if it
   is inlined in a Vite hook. If the plugin has to reproduce it for Rsbuild,
   record it in `scripts/upstream-mirrors.json` so that its changes are
   flagged.
5. **Check the options.** Compare upstream's `PluginConfig`
   (`src/plugin-config.ts`) with the plugin's (`index.ts`). Check that every
   upstream option is passed through and has an effect, or is documented as
   unsupported. Check that defaults (paths, environment names, persistence,
   inspector port) resolve the same way.
6. **Check the patches.** For each patch in `patches/`, confirm it still applies
   to the code it's meant to change and is still needed. Upstream may now
   export the declaration or have the test hook.
7. **Confirm suspicions with tests where cheap.** Run one targeted playground or
   e2e spec, e.g.
   `pnpm -F rsbuild-plugin-cloudflare-test-harness test:playground:serve <name>`,
   rather than whole suites, and nothing that needs Cloudflare credentials.

## Report

Don't change code unless asked. Report:

- a table of the divergences and missing behaviours, with columns: area, what
  upstream does (with `file:line` in the submodule), what the plugin does (with
  `file:line`), status, and the suggested fix;
- the adapter contract gaps from step 3;
- re-implemented upstream logic from step 4;
- whether the README's differences list and the skip lists are still accurate,
  including entries that upstream changes have made obsolete.

Order the findings by user impact. For each fix, say whether it keeps the plugin
a thin wrapper. Prefer fixes that call or export upstream code. Fixes that add
non-trivial non-Rsbuild logic to the plugin are a reason to reassess with the
user. They're not a change to just make. Never edit `workers-sdk/`. Changes to
it go in `patches/`.
