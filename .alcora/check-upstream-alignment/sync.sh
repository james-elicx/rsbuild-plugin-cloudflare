#!/usr/bin/env bash
# The commands of a sync, which run in the sandbox around the agent (see
# alcora.json and README.md):
#
#   sync.sh bump    --repo <checkout> --out <dir>            branches from main and bumps
#   sync.sh rebase  --repo <checkout> --out <dir> [--bump]   a later round: rebases onto main
#   sync.sh prepare --repo <checkout> --out <dir> [--bump]   a later round: sets up, and bumps
#   sync.sh publish --repo <checkout> --out <dir>            pushes, and opens or edits the pull request
#
# Bumping moves workers-sdk to upstream's main and updates the dependencies
# that don't follow it, in the commits that the Actions sync made. The phases
# share what they found in <out>/sync.env, and tell the agent in <out>/sync.md.
#
# Exit codes, besides 0 and failures: 3 when workers-sdk and the dependencies
# are up to date (bump, prepare), 2 when the rebase stopped at conflicts
# (rebase), 4 when they're still unresolved or a commit pins a layout commit
# (prepare, publish), 5 when the branch was only rebased (prepare), and 6 when
# the pull request is no longer open (rebase).
set -euo pipefail

command="${1:-}"
shift || true
repo=""
out=""
bump=false
while (($# > 0)); do
	case "$1" in
		--repo) repo="$2" && shift 2 ;;
		--out) out="$2" && shift 2 ;;
		--bump) bump=true && shift ;;
		*) echo "sync.sh: unknown argument $1" >&2 && exit 2 ;;
	esac
done
if [[ -z "$repo" || -z "$out" ]]; then
	echo "sync.sh: --repo and --out are required" >&2
	exit 2
fi

skill="$(cd "$(dirname "$0")" && pwd)"
base="${ALCORA_PR_BASE:-main}"
cd "$repo"

# The files that bumping and updating the dependencies change. The pin is
# staged by scripts/fetch-upstream.sh.
dependency_files=(package.json pnpm-lock.yaml packages/*/package.json packages/e2e/fixtures/*/package.json pnpm-workspace.yaml .github/actions/setup/action.yml)

state() { echo "$1=$2" >>"$out/sync.env"; }
get() { sed -n "s/^$1=//p" "$out/sync.env" 2>/dev/null | tail -n 1; }
note() { printf '%s\n' "$@" >>"$out/sync.md"; }
report() { node "$skill/report.cjs" report --out "$out" "$@"; }

# The open pull request from a branch, or nothing.
open_pr() {
	gh pr list --head "$1" --base "$base" --state open --json number --jq '.[0].number // empty'
}

# Ends a continuation whose pull request merged or closed, e.g. while it
# waited for the sandbox: there's nothing left to sync, and the next day's
# sync opens a new one.
closed() {
	report --result closed --summary "The sync's pull request${1:+ from $1} is no longer open, so there's nothing to do."
}

# Shows the end of a log in sync.md, for the agent.
note_log() {
	note "" "\`\`\`" "$(tail -n 40 "$1")" "\`\`\`"
}

# Keeps git from recording workers-sdk's layout commit as the pin (see
# scripts/fetch-upstream.sh). The runner's checkout doesn't carry the flag.
protect() {
	git update-index --skip-worktree workers-sdk
}

# Lays workers-sdk out at the pin, from scratch (dropping the patches, which
# may have changed), then sets it up.
set_up() {
	local status=0
	{
		./scripts/fetch-upstream.sh &&
			git -C workers-sdk reset --quiet --hard &&
			git -C workers-sdk clean -fdq &&
			pnpm setup:upstream &&
			pnpm install --frozen-lockfile
	} >"$out/setup-upstream.log" 2>&1 || status=$?
	cat "$out/setup-upstream.log"
	if ((status != 0)); then
		state FAILED setup
		note "" "Setting up workers-sdk at the pin failed (exit $status). The end of its output:"
		note_log "$out/setup-upstream.log"
	fi
	return 0
}

# Bumps workers-sdk and updates the dependencies, in commits of their own, as
# the Actions sync did. A failed bump (e.g. a patch that no longer applies) is
# committed as far as it got, for the agent to finish.
bump_commits() {
	local before after status=0
	before="$(git rev-parse :workers-sdk)"
	./scripts/bump-upstream.sh origin/main >"$out/bump.log" 2>&1 || status=$?
	cat "$out/bump.log"
	after="$(git rev-parse :workers-sdk)"
	git add -- "${dependency_files[@]}"
	if ! git diff --cached --quiet; then
		{
			echo "Bump workers-sdk to ${after:0:9}"
			echo
			node "$skill/report.cjs" log --from "$before" --to "$after" --limit 100
		} | git commit --quiet --no-verify --file -
	fi
	if [[ "$before" == "$after" ]]; then
		note "" "workers-sdk is still at $after, the head of upstream's main."
	else
		note "" "workers-sdk moved from $before to $after:" "" "$(node "$skill/report.cjs" log --from "$before" --to "$after" --limit 100)"
	fi
	if ((status != 0)); then
		state FAILED bump
		note "" "scripts/bump-upstream.sh failed (exit $status), so the dependencies weren't updated. Finish the bump: the pin is moved, and the end of its output is:"
		note_log "$out/bump.log"
		return 0
	fi

	status=0
	pnpm update:deps --report "$out/dependencies.md" --outdated "$out/outdated.json" >"$out/update-deps.log" 2>&1 || status=$?
	cat "$out/update-deps.log"
	git add -- "${dependency_files[@]}"
	if ! git diff --cached --quiet; then
		git commit --quiet --no-verify --message "Update dependencies"
		note "" "The dependencies that don't follow workers-sdk were updated within their ranges, as \"Update dependencies\"."
	fi
	if [[ -s "$out/dependencies.md" ]]; then
		note "" "## Newer versions outside their ranges" "" "$(cat "$out/dependencies.md")" "" "Update each of them, as \"How to sync\" says, in a commit of its own."
	fi
	if ((status != 0)); then
		state FAILED update-deps
		note "" "\`pnpm update:deps\` failed (exit $status). The end of its output:"
		note_log "$out/update-deps.log"
	fi
}

# Fetches the pull requests' base, with the history that rebasing needs. Not
# workers-sdk: when the fetched commits move the pin, git would fetch in its
# layout too, which has no remote, and fail.
fetch_base() {
	local depth=()
	if [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
		depth=(--unshallow)
	fi
	git fetch --quiet --no-recurse-submodules ${depth[@]+"${depth[@]}"} origin "+refs/heads/$base:refs/remotes/origin/$base"
}

case "$command" in
	bump)
		protect
		branch="${ALCORA_BRANCH_PREFIX:?}upstream-sync"
		git checkout --quiet -B "$branch"
		main="$(git rev-parse HEAD)"
		state BRANCH "$branch"
		state PR_HEAD ""
		state MAIN "$main"
		note "# This round" "" "A new sync: the branch \`$branch\` starts from \`$base\` at $main."
		bump_commits
		state PIN "$(git rev-parse HEAD:workers-sdk)"
		if [[ "$(git rev-parse HEAD)" == "$main" ]]; then
			report --result up_to_date --summary "workers-sdk and the dependencies are up to date."
			exit 3
		fi
		;;

	rebase)
		protect
		# The agent may answer `flaky` only in a round for failed checks, which
		# the workflow re-runs.
		if $bump; then state ROUND sync; else state ROUND checks; fi
		head="$(git rev-parse HEAD)"
		branch="$(git branch --show-current)"
		if [[ -z "$branch" ]]; then
			# A sandbox that was gone starts again from the pull request's head.
			branch="$(gh pr list --base "$base" --state open --json headRefName,headRefOid \
				--jq ".[] | select(.headRefOid == \"$head\") | .headRefName" | head -n 1)"
			if [[ -z "$branch" ]]; then
				closed
				exit 6
			fi
			git checkout --quiet -B "$branch"
		elif [[ -z "$(open_pr "$branch")" ]]; then
			closed "$branch"
			exit 6
		fi
		fetch_base
		main="$(git rev-parse "origin/$base")"
		state BRANCH "$branch"
		state PR_HEAD "$head"
		state MAIN "$main"
		note "# This round" "" "The pull request's branch \`$branch\` is at $head, and \`$base\` at $main."
		if ! $bump; then
			note "" "This round doesn't rebase or bump: it fixes the pull request as it is."
			exit 0
		fi
		if git merge-base --is-ancestor "$main" HEAD; then
			note "" "The branch is on \`$base\`'s head already."
			exit 0
		fi
		if git -c core.editor=true rebase --quiet "$main" >"$out/rebase.log" 2>&1; then
			cat "$out/rebase.log"
			note "" "The branch was rebased onto \`$base\` cleanly."
			exit 0
		fi
		cat "$out/rebase.log"
		{
			echo "# Rebase conflicts"
			echo
			echo "\`git rebase $main\` (\`$base\`'s head) stopped at conflicts, on the branch \`$branch\` of the sync's pull request."
			echo
			echo "Conflicted files:"
			echo
			git diff --name-only --diff-filter=U | sed 's/^/- /'
			echo
			echo "\`git status\`:"
			echo
			echo "\`\`\`"
			git status
			echo "\`\`\`"
		} >"$out/conflicts.md"
		exit 2
		;;

	prepare)
		protect
		if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
			files="$(git diff --name-only --diff-filter=U | paste -sd, - | sed 's/,/, /g')"
			git rebase --abort
			report --result needs_human --summary "The branch doesn't rebase onto $base." \
				--reason "Rebasing the sync's branch onto \`$base\` stopped at conflicts that the agent couldn't resolve${files:+, in $files}. Rebase it by hand, or close the pull request for the next sync to start afresh."
			exit 4
		fi
		if $bump && ! git merge-base --is-ancestor "$(get MAIN)" HEAD; then
			report --result needs_human --summary "The branch doesn't rebase onto $base." \
				--reason "Rebasing the sync's branch onto \`$base\` stopped at conflicts that the agent couldn't resolve. Rebase it by hand, or close the pull request for the next sync to start afresh."
			exit 4
		fi
		if [[ "$(get PR_HEAD)" != "$(git rev-parse HEAD)" ]]; then
			note "" "After rebasing, the branch is at $(git rev-parse HEAD)."
		fi
		set_up
		if $bump; then
			rebased="$(git rev-parse HEAD)"
			bump_commits
			state PIN "$(git rev-parse HEAD:workers-sdk)"
			if [[ "$(git rev-parse HEAD)" == "$(get PR_HEAD)" ]]; then
				report --result up_to_date --summary "workers-sdk, the dependencies and the branch are up to date."
				exit 3
			fi
			if [[ "$(git rev-parse HEAD)" == "$rebased" && -z "$(get FAILED)" ]]; then
				report --result rebased --summary "Rebased onto $base; workers-sdk and the dependencies are up to date."
				exit 5
			fi
		else
			state PIN "$(git rev-parse HEAD:workers-sdk)"
		fi
		;;

	publish)
		protect
		branch="$(get BRANCH)"
		head="$(get PR_HEAD)"
		main="$(get MAIN)"
		# Every commit to push must pin an upstream commit, not one of the
		# layout's own.
		for commit in $(git rev-list "$main..HEAD"); do
			pin="$(git rev-parse "$commit:workers-sdk")"
			if git -C workers-sdk cat-file -e "$pin^{commit}" 2>/dev/null; then
				report --result needs_human --summary "A commit pins workers-sdk's layout, not an upstream commit." \
					--reason "$(git log -1 --format='%h (%s)' "$commit") pins $pin, a commit of the sandbox's archive of workers-sdk rather than of upstream, so nothing was pushed."
				exit 4
			fi
		done
		number="$(open_pr "$branch")"
		# A continuation only updates its pull request, which may have merged
		# or closed during the round. Only a new sync opens one.
		if [[ -n "$(get ROUND)" && -z "$number" ]]; then
			closed "$branch"
			exit 0
		fi
		if [[ "$(git rev-parse HEAD)" == "$head" ]]; then
			echo "Nothing new to push."
		else
			# Rebasing rewrites the branch; the lease keeps a push by someone else.
			git push --quiet --force-with-lease="refs/heads/$branch:$head" origin "HEAD:refs/heads/$branch"
		fi
		pin="$(git rev-parse HEAD:workers-sdk)"
		previous="$out/previous-body.md"
		: >"$previous"
		if [[ -n "$number" ]]; then
			gh pr view "$number" --json body --jq .body >"$previous"
		fi
		node "$skill/report.cjs" body --out "$out" --main-pin "$(git rev-parse "$main:workers-sdk")" --pin "$pin" \
			--changes "$(git log --reverse --format=%s "$main..HEAD")" --previous "$previous" >"$out/pr-body.md"
		title="Sync with workers-sdk ${pin:0:9}"
		result="$(node -p 'require(process.argv[1]).result' "$out/sync-report.json")"
		if [[ -n "$number" && "$result" == "rebased" ]]; then
			# Only the base moved: what the description says still holds.
			echo "Rebased #$number onto $base."
		elif [[ -n "$number" ]]; then
			gh pr edit "$number" --title "$title" --body-file "$out/pr-body.md"
		else
			gh pr create --base "$base" --head "$branch" --title "$title" --body-file "$out/pr-body.md"
		fi
		;;

	*)
		echo "sync.sh: unknown command ${command:-(none)}" >&2
		exit 2
		;;
esac
