---
name: find-upstream-sync-pr
description: Find the open pull request of rsbuild-plugin-cloudflare's Alcora sync with workers-sdk, whose branch is alcora/<run>/<step>/upstream-sync.
---

# Find the sync's pull request

List the open pull requests into `main` and keep the newest whose branch, in
this repository, matches `^alcora/[^/]+/[^/]+/upstream-sync$`:

```sh
gh pr list --base main --state open --json number,url,headRefName \
  --jq '[.[] | select(.headRefName | test("^alcora/[^/]+/[^/]+/upstream-sync$"))] | sort_by(.number) | last'
```

The Alcora skill runs this as `find.sh`, with no agent.
