#!/usr/bin/env bash
# Writes <out>/sync-pr.json: the open pull request that a sync step opened from
# alcora/<run>/<step>/upstream-sync into the default branch, the newest if
# there are several, or {} when there is none. `labelled` is "true" when it's
# labelled "sync: merge on green", i.e. the last round left it ready.
#
#   find.sh --out <dir>
set -euo pipefail

if [[ "${1:-}" != "--out" || -z "${2:-}" ]]; then
	echo "find.sh: --out is required" >&2
	exit 2
fi
out="$2"

gh pr list --base "${ALCORA_DEFAULT_BRANCH:-main}" --state open --limit 100 \
	--json number,url,headRefName,isCrossRepository,labels \
	--jq '[.[] | select((.isCrossRepository | not) and (.headRefName | test("^alcora/[^/]+/[^/]+/upstream-sync$")))]
		| sort_by(.number) | last
		| if . == null then {} else {
			number: (.number | tostring),
			url,
			branch: .headRefName,
			labelled: (if any(.labels[]; .name == "sync: merge on green") then "true" else "" end)
		} end' \
	>"$out/sync-pr.json"
cat "$out/sync-pr.json"
