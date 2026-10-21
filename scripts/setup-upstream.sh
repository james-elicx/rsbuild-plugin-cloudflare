#!/usr/bin/env bash
# Prepares the workers-sdk submodule: checks out the pinned commit, applies the
# patches, installs its dependencies and builds the packages that this
# repository uses.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

git -C "$root" submodule update --init --recursive
"$root/scripts/apply-patches.sh"
pnpm -C "$root/workers-sdk" install --frozen-lockfile
# Builds the Vite plugin (whose `dist/workers` the Rsbuild plugin ships) and the
# packages that it depends on, including Miniflare.
pnpm -C "$root/workers-sdk" exec turbo build --filter @cloudflare/vite-plugin
