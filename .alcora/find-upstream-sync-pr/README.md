# Find the sync's pull request

`rsbuild-plugin-cloudflare/find-upstream-sync-pr` finds the open pull request
of [rsbuild-plugin-cloudflare](https://github.com/james-elicx/rsbuild-plugin-cloudflare)'s
sync with workers-sdk, for the [Upstream sync](../upstream-sync/README.md)
workflow, which continues its sandbox rather than opening another.

It starts with an empty folder, clones nothing and runs no agent: `find.sh`
lists the open pull requests into the default branch with `gh`, and keeps
those from a branch `alcora/<run>/<step>/upstream-sync` of the repository.

**Outputs:** `pr`, the newest one's number, empty when none is open; `url`;
`head_ref`, its branch; `labelled`, `true` when it's labelled
`sync: merge on green`, i.e. the last round left it ready. It doesn't branch:
If steps after it decide.

**GitHub access:** Read.

`SKILL.md` is only what Alcora requires of a skill package: nothing reads it.
