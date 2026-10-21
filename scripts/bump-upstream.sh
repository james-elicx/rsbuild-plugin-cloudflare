#!/usr/bin/env bash
# Moves the workers-sdk submodule to a ref (default: origin/main), then
# re-applies the patches, rebuilds upstream and syncs the plugin's
# dependencies. Review and commit the result.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
upstream="$root/workers-sdk"
ref="${1:-origin/main}"

"$root/scripts/apply-patches.sh" --reverse
if [[ -n "$(git -C "$upstream" status --porcelain --untracked-files=no)" ]]; then
	echo "The workers-sdk submodule has changes that aren't from patches/." >&2
	exit 1
fi
git -C "$upstream" fetch origin
git -C "$upstream" checkout --detach "$ref"
echo "workers-sdk is now at $(git -C "$upstream" rev-parse HEAD)"

"$root/scripts/apply-patches.sh"
pnpm -C "$upstream" install --frozen-lockfile
pnpm -C "$upstream" exec turbo build --filter @cloudflare/vite-plugin
node --experimental-strip-types "$root/scripts/sync-upstream-deps.ts"
pnpm -C "$root" install --no-frozen-lockfile
