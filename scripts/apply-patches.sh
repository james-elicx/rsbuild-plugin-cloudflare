#!/usr/bin/env bash
# Applies `patches/*.patch` to the workers-sdk submodule, skipping patches that
# are already applied. With `--reverse`, reverts them instead.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
upstream="$root/workers-sdk"
reverse="${1:-}"

shopt -s nullglob
patches=("$root"/patches/*.patch)
if [[ "$reverse" == "--reverse" ]]; then
	# Revert in the opposite order, in case patches touch the same files.
	for ((i = ${#patches[@]} - 1; i >= 0; i--)); do
		patch="${patches[i]}"
		if git -C "$upstream" apply --reverse --check "$patch" 2>/dev/null; then
			git -C "$upstream" apply --reverse "$patch"
			echo "Reverted $(basename "$patch")"
		fi
	done
	exit 0
fi

for patch in "${patches[@]}"; do
	if git -C "$upstream" apply --reverse --check "$patch" 2>/dev/null; then
		echo "Already applied $(basename "$patch")"
	else
		git -C "$upstream" apply "$patch"
		echo "Applied $(basename "$patch")"
	fi
done
