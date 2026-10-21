# AGENTS.md

This file helps AI coding agents work in this repository. It follows the
conventions of workers-sdk (`workers-sdk/AGENTS.md`), which the code is meant to
be able to move back into.

## The goal: a thin wrapper over upstream

`rsbuild-plugin-cloudflare` is a minimal wrapper over the internals of
workers-sdk's Vite plugin. Behaviour belongs upstream; this repository holds
only the Rsbuild glue (hooks, environment config, rspack rules) and the
adapters that let the Vite plugin's internals run under Rsbuild.

If a change makes the glue grow substantially, or needs non-trivial logic that
isn't Rsbuild-specific, stop and reassess: the better fix is usually an upstream
change that exposes what the plugin needs.

## Repository rules

- **Never edit `workers-sdk/`.** It's a pinned submodule. Hooks that the plugin
  or the test harness need are small patches in `patches/`, applied by
  `scripts/apply-patches.sh` (see [UPSTREAM.md](UPSTREAM.md)).
- **Import upstream code directly** from the submodule (by relative path, e.g.
  `../../../workers-sdk/packages/vite-plugin-cloudflare/src/context`) or from
  a package linked to it (e.g. `@cloudflare/workers-utils`).
- **Prefer reusing upstream code to copying it.** If upstream has a top-level
  declaration that just isn't exported, export it with a patch (see
  `patches/0004-vite-plugin-export-internals.patch`). Only copy code that is
  inlined in Vite hooks: copy it into `src/upstream/copied.ts`, record the
  upstream declaration in `src/upstream/upstream-copies.json`, and run
  `pnpm check:copied-code --update`. `src/upstream/` holds only copies.
- **Don't change upstream behaviour.** Adapters may only post-process upstream
  results for Rsbuild. Document every intentional difference from the Vite
  plugin in `packages/rsbuild-plugin/README.md`.
- **Check alignment with the Vite plugin.** Copies are checked by
  `pnpm check:copied-code`, but nothing checks that the glue and adapters still
  behave like the Vite plugin. After the submodule moves, or when changing them,
  follow the `check-upstream-alignment` skill
  (`.claude/skills/check-upstream-alignment/SKILL.md`).
- **Skip upstream tests only for Vite-specific behaviour**, with a reason, in
  `packages/test-harness/vitest.playground.config.ts` or
  `vitest.e2e.config.ts`.
- **Dependencies follow upstream.** The plugin's runtime dependencies are the
  Vite plugin's, and the tooling versions are workers-sdk's;
  `scripts/sync-upstream-deps.ts` updates them.

## Start here

- Use `pnpm`, not npm or yarn, with the Node.js and pnpm versions declared in
  `package.json`.
- Run `pnpm setup:upstream` before `pnpm install`, and again after the
  submodule moves.
- Run commands from the repository root.

## Common commands

The root `package.json` is authoritative for available scripts.

- `pnpm build` — build the plugin.
- `pnpm check` — the upstream checks, then lint, format and type checks.
- `pnpm fix` — apply lint and formatting fixes.
- `pnpm prettify` — format files with oxfmt.
- `pnpm test` — the plugin's unit tests.
- `pnpm test:playground` / `pnpm test:e2e` — the Vite plugin's playground and
  e2e suites against Rsbuild.

Prefer the narrowest relevant test while developing (e.g.
`pnpm -F rsbuild-plugin-cloudflare-test-harness test:playground:serve assets`),
then run the broader checks. Don't run tests that need Cloudflare credentials
unless the task and environment support them.

## Implementation conventions

These are workers-sdk's. The checked-in configuration (`.oxlintrc.jsonc`,
`.oxfmtrc.jsonc`) is authoritative; run `pnpm check` rather than relying on
this list.

- Keep TypeScript strictly typed. Avoid `any`, non-null assertions, and floating
  promises.
- Use type-only imports where appropriate and `node:` prefixes for Node.js
  built-ins.
- Prefer function declarations for named or exported functions.
- Add well-formatted JSDoc to exported or public functions and to functions whose
  purpose is not evident, including useful tags such as `@param` and `@returns`
  where appropriate.
- Comments should explain why; do not add comments that merely restate code.
- Lint-disable comments require a reason after `--`.
- Don't depend on `vite`: derive the Vite types that the internals need from
  their signatures (see `src/vite-server.ts`).

oxfmt determines whitespace, quoting, import order, and package.json sorting.
Do not reproduce those rules manually; run `pnpm prettify`.

## Testing conventions

- Use Vitest for unit and integration tests.
- In Vitest tests, obtain `expect` from the test context rather than importing
  it from `vitest`.
- Prefer `runInTempDir()` and real filesystem operations over filesystem mocks.
- Use fixtures for Worker scenarios, and keep them clear and realistic.

## Changes and pull requests

- Work on a branch rather than committing directly to `main`.
- Use the `[package] description` title style, e.g.
  `[rsbuild-plugin] Support X`.
- Run the relevant tests and checks locally before pushing.
- Write commit subjects as release notes. Changesets are generated from them
  (see [.changeset/README.md](.changeset/README.md)): the subject, without its
  `[package]` scope, is the changelog entry. Write
  a changeset by hand (`pnpm changeset`) only for a minor or major bump.
