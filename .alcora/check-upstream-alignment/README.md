# Sync with workers-sdk

`rsbuild-plugin-cloudflare/check-upstream-alignment` syncs
[rsbuild-plugin-cloudflare](https://github.com/james-elicx/rsbuild-plugin-cloudflare)
with workers-sdk, in an Alcora sandbox, for the
[Upstream sync](../upstream-sync/README.md) workflow. It's the repository's
`check-upstream-alignment` skill, whose `SKILL.md` is in this folder
(`.claude/skills/check-upstream-alignment/SKILL.md` links to it, for Claude
Code), with what it takes to run it unattended.

A new sync, from the repository set up (from the snapshot when it's current):

| Phase   |                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup   | The project's setup commands: `scripts/fetch-upstream.sh` lays workers-sdk out from GitHub's archive of the pinned commit, since the sandbox can't clone the submodule, then `pnpm setup:upstream`.                                                                                                                                                                             |
| Bump    | `sync.sh bump`: branches `alcora/<run>/<step>/upstream-sync` from `main`, bumps workers-sdk to upstream's `main` and updates the dependencies that don't follow it, in commits of their own. Stops, up to date, when nothing moved.                                                                                                                                             |
| Align   | The agent finishes the bump, follows `SKILL.md` on upstream's changes and applies its fixes, until `pnpm check`, the build, the unit tests and the affected playground and e2e specs pass. `alcora.md` is the contract: commit but don't push, never pin the layout's own commits, leave Rsbuild's and Rspack's failures failing, stay a thin wrapper, and the answer's format. |
| Report  | `report.cjs answer` reads the agent's answer into `sync-report.json`.                                                                                                                                                                                                                                                                                                           |
| Publish | `sync.sh publish`: checks that every commit pins an upstream commit, pushes the branch, and opens the pull request, its description listing upstream's commits (from GitHub's API), the dependency updates and the plugin's changes.                                                                                                                                            |

A step that continues the sandbox (start: the pull request's sandbox) runs the
continuation, with **Rebase and bump** on for the day's sync and off for
failed checks:

| Phase           |                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rebase          | `sync.sh rebase`: stops, closed, when the pull request merged or closed (say while the step waited for the sandbox). With Rebase and bump, rebases the branch onto `main`; on conflicts, jumps to Resolve. |
| Resolve         | Only after conflicts: an agent finishes the rebase, following `resolve.md`. What it can't resolve, it leaves, and the next phase aborts the rebase as needing a person.                                    |
| Bump (prepare)  | `sync.sh prepare`: lays workers-sdk out at the branch's pin again and sets it up (the sandbox may have been gone), then bumps, as above. Only rebased: on to Publish.                                      |
| Align           | The agent again, resuming its session, for the day's changes or the failed checks in its prompt.                                                                                                           |
| Report, Publish | As above, also answering `flaky`, in a round for failed checks, for failures that a re-run should pass. Publish only edits the pull request, and stops, closed, if it merged or closed meanwhile.          |

**Outputs:** `result` (`ready`, `needs_human` or `up_to_date`; a continuation
also `flaky`, `rebased` and `closed`), on which the step branches, `explanation`,
`tests`, `reason` (what a person has to do) and `upstream` (the commit it pins).

**GitHub access:** Read, Push branches of its own, and Open pull requests into
`main`, with the sandbox kept. It never merges, labels or comments: the
workflow does that.
