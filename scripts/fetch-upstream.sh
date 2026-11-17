#!/usr/bin/env bash
# Lays out workers-sdk from GitHub's archive of a commit, for checkouts that
# can't clone the submodule, such as the Alcora sandboxes that sync it (see
# UPSTREAM.md), which reach no other repository over git. Without an argument,
# lays out the pinned commit. With a workers-sdk branch, tag or SHA, lays out
# that commit and stages it as the new pin. Then run `pnpm setup:upstream`,
# which applies the patches, installs and builds.
#
# workers-sdk/ becomes a git repository of its own, with a commit for each
# archive that it lays out, so that the patches apply with `git apply` and the
# previous pin stays at `HEAD~1` (`git -C workers-sdk diff HEAD~1`). Those
# commits aren't upstream's: each one names its upstream commit in its subject.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
upstream="$root/workers-sdk"
repository="cloudflare/workers-sdk"
ref="${1:-}"

if [[ -f "$upstream/.git" ]]; then
	echo "workers-sdk is a submodule checkout: use scripts/setup-upstream.sh or scripts/bump-upstream.sh." >&2
	exit 1
fi

# The commit that the layout holds, from its subject.
laid_out() {
	if [[ -d "$upstream/.git" ]]; then
		git -C "$upstream" log -1 --format=%s 2>/dev/null | sed -n "s|^$repository@\([0-9a-f]\{40\}\)\$|\1|p"
	fi
}

pinned="$(git -C "$root" rev-parse :workers-sdk)"
if [[ -z "$ref" && "$(laid_out)" == "$pinned" ]]; then
	echo "workers-sdk is laid out at $pinned"
	exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --fail --silent --show-error --location --retry 3 \
	--output "$tmp/archive.tar.gz" \
	"https://codeload.github.com/$repository/tar.gz/${ref:-$pinned}"
# `git archive` records the commit in the tarball's header; get-tar-commit-id
# stops reading after it.
sha="$({ gzip -dc "$tmp/archive.tar.gz" 2>/dev/null || true; } | git get-tar-commit-id)"
mkdir "$tmp/tree"
tar -xzf "$tmp/archive.tar.gz" -C "$tmp/tree" --strip-components=1

if [[ ! -d "$upstream/.git" ]]; then
	mkdir -p "$upstream"
	git -C "$upstream" init --quiet
fi
if [[ "$(laid_out)" != "$sha" ]]; then
	# The archive's files exactly, including those that its .gitignore files
	# match.
	GIT_DIR="$upstream/.git" GIT_WORK_TREE="$tmp/tree" GIT_INDEX_FILE="$tmp/index" \
		git add --all --force
	tree="$(GIT_DIR="$upstream/.git" GIT_INDEX_FILE="$tmp/index" git write-tree)"
	parent=()
	if head="$(git -C "$upstream" rev-parse --verify --quiet HEAD)"; then
		parent=(-p "$head")
		# Drops the patches' changes, and the files that they added.
		git -C "$upstream" reset --quiet --hard
		git -C "$upstream" clean -fdq
	fi
	commit="$(git -C "$upstream" -c user.name="workers-sdk archive" -c user.email="archive@workers-sdk.invalid" \
		commit-tree "$tree" ${parent[@]+"${parent[@]}"} -m "$repository@$sha")"
	# Replaces the tracked files, but keeps what git ignores, such as
	# node_modules and builds, so that installing and building stay
	# incremental.
	git -C "$upstream" reset --quiet --hard "$commit"
fi

if [[ -n "$ref" ]]; then
	git -C "$root" update-index --cacheinfo "160000,$sha,workers-sdk"
fi
# Keeps git from recording the layout's own commit as the pin, as `git add -A`
# and `git commit -a` would. Checkouts, resets and rebases keep the flag.
git -C "$root" update-index --skip-worktree workers-sdk
echo "workers-sdk is laid out at $sha"
