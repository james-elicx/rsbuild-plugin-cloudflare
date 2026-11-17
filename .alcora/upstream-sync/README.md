# Upstream sync

`rsbuild-plugin-cloudflare/upstream-sync` keeps
[rsbuild-plugin-cloudflare](https://github.com/james-elicx/rsbuild-plugin-cloudflare)
in line with workers-sdk. It replaces the repository's GitHub Actions sync:
each sync bumps workers-sdk, and also aligns the plugin with the Vite plugin's
changes, following the `check-upstream-alignment` skill, until the checks and
tests pass. [UPSTREAM.md](../../UPSTREAM.md) describes the process and how to
turn it on.

## The day's sync

```
Every day (14:00 UTC) ─┐
Sync now ──────────────┴─▶ Find the sync's pull request ─▶ Sync pull request open?
   yes ─▶ Hold off merging ─▶ Rebase and sync again (continue its sandbox) ─┐
   no  ─▶ Sync with workers-sdk (snapshot, sandbox kept) ───────────────────┤
           ready ─▶ Merge on green (label)                                  │
           needs_human ─▶ Say what it needs (comment)                       │
   Rebase and sync again: rebased, up_to_date ─▶ Was it ready? ─ yes ─▶ Merge on green
```

- **Find the sync's pull request** lists the open pull requests from a branch
  `alcora/<run>/<step>/upstream-sync`, with no agent.
- **Sync with workers-sdk** runs when none is open: from the snapshot, it bumps
  workers-sdk to upstream's `main`, aligns the plugin and opens the pull
  request. Its sandbox is kept, so the pull request is the workflow's to
  continue.
- **Rebase and sync again** runs when one is open: it continues that sandbox,
  rebases the branch onto `main` (an agent resolves conflicts), bumps again and
  aligns with the day's changes. Fixes pushed to the branch by a person are
  kept.
- Ready, it labels the pull request `sync: merge on green`, which the
  repository's `merge-upstream-sync.yml` merges once CI passes on its head:
  Alcora doesn't merge. Needing a person, it comments why, once per upstream
  commit.
- Up to date, or only rebased onto `main`, the pull request is labelled again
  only if it was labelled before (**Was it ready?**): one that needed a person
  stays unlabelled, so a rebase doesn't wave it through.
- If the pull request merged or closed before the sandbox was free (a round of
  fixes had it, and its fix was merged), the step ends `closed` and does
  nothing; the next day's sync opens a new one. A continuation never opens a
  pull request.

The label is removed before each round, so a head that a round hasn't finished
with isn't merged.

**Sync now** starts the day's sync at once, from the default branch's head,
for testing or to catch up. It takes no workers-sdk ref: the sync always moves
to upstream's `main`.

## Failed checks

```
CI failed ─▶ On the head? ─▶ The sync's pull request? ─▶ Hold off merging ─▶ Under 20 rounds?
   yes ─▶ Fix the checks (continue its sandbox, no rebase or bump)
             ready ─▶ Merge on green
             flaky ─▶ Re-run them ─▶ rerun: Merge on green / none: Say what it needs
             needs_human ─▶ Say what it needs
   no  ─▶ Say it took too many rounds
```

Only failures of the `CI` workflow's jobs, on the pull request's current head,
start a round, one at a time per pull request. The sync's pull requests are
told apart by their branch (**The sync's pull request?**), since a package
can't name the workflow it belongs to in **Pull requests opened by**: so
every tracked pull request in the repository whose CI fails, such as another
workflow's issue fix, starts a run that stops there. Those runs are only noise
in the run list. To quiet them, set the trigger's **Pull requests opened by**
to this workflow once it's installed.

A day's sync and a round of fixes continue the same sandbox: Alcora runs them
one after the other, and whichever runs second sees the other's commits.

## Knobs

| Knob                    |                                                                |
| ----------------------- | -------------------------------------------------------------- |
| Sync every day at (UTC) | When the day's sync starts.                                    |
| Model, Effort           | The agent that aligns the plugin and fixes the checks.         |
| Instance                | workers-sdk's setup and the playground tests want the largest. |

**Needs:** the snapshot of the repository set up (the
[Sandbox snapshot](https://alcora.dev) workflow); the GitHub App's Actions
permission, read for the CI filter and read and write for re-runs; the
`sync: merge on green` label.
