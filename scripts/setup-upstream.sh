#!/usr/bin/env bash
# Prepares the workers-sdk submodule: checks out the pinned commit, applies the
# patches, installs its dependencies and builds the packages that this
# repository uses. A workers-sdk laid out from an archive
# (scripts/fetch-upstream.sh) is laid out at the pinned commit instead.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -d "$root/workers-sdk/.git" ]]; then
	"$root/scripts/fetch-upstream.sh"
else
	git -C "$root" submodule update --init --recursive
fi
"$root/scripts/apply-patches.sh"
pnpm -C "$root/workers-sdk" install --frozen-lockfile
# Builds the Vite plugin (whose `dist/workers` the Rsbuild plugin ships) and the
# packages that it depends on, including Miniflare.
pnpm -C "$root/workers-sdk" exec turbo build --filter @cloudflare/vite-plugin
