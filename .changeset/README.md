# Changesets

Releases are made with [changesets](https://github.com/changesets/changesets),
but the changesets are generated rather than written by hand: on each push to
`main`, `.github/workflows/publish.yml` runs `scripts/generate-changesets.ts`,
which writes a patch changeset for each change since the last release:

- each commit that changes `packages/rsbuild-plugin` (other than its tests),
  with the commit's subject;
- each workers-sdk commit that changes the Vite plugin (other than its tests),
  brought in by a commit that moves the submodule, with the upstream commit's
  subject.

The workflow then opens (or updates) a "Version Packages" pull request with
the new version and changelog. `scripts/format-changelog.ts` lists the upstream
changes under their own heading. Merging it publishes the release to npm.

So write commit subjects as release notes: each is a changelog entry.
Changesets written by hand (`pnpm changeset`) are released too, e.g. for a
minor or major bump.
