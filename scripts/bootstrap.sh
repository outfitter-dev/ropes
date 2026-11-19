#!/usr/bin/env bash
set -euo pipefail

# Resolve this checkout, including linked worktrees, regardless of the caller's cwd.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -ne 0 ]]; then
  echo "Usage: ./scripts/bootstrap.sh" >&2
  exit 2
fi

# mise.toml is the one place tool versions are pinned. See docs/tool-versions.md.
if [[ ! -f mise.toml ]]; then
  echo "Error: missing mise.toml in $REPO_ROOT" >&2
  exit 1
fi
PINNED_VERSION="$(sed -n 's/^bun = "\([0-9][0-9.]*\)"$/\1/p' mise.toml)"
if [[ ! "$PINNED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: mise.toml must pin bun to a three-part version." >&2
  exit 1
fi

# With mise, every pinned tool is installed at its exact version. Without it,
# a Bun at or above the pin is accepted, because a newer runtime on the host is
# not a reason to stop. External tools such as rumdl are then the host's to supply.
if command -v mise >/dev/null 2>&1; then
  mise install
  BUN=(mise exec -- bun)
else
  if ! command -v bun >/dev/null 2>&1; then
    echo "Error: install mise (https://mise.jdx.dev) or Bun $PINNED_VERSION, then rerun bootstrap." >&2
    exit 1
  fi
  ACTUAL_VERSION="$(bun --version)"
  OLDEST="$(printf '%s\n%s\n' "$PINNED_VERSION" "$ACTUAL_VERSION" | sort -V | head -n 1)"
  if [[ "$OLDEST" != "$PINNED_VERSION" ]]; then
    echo "Error: Bun $ACTUAL_VERSION is older than the pinned $PINNED_VERSION. Install mise or a newer Bun." >&2
    exit 1
  fi
  if [[ "$ACTUAL_VERSION" != "$PINNED_VERSION" ]]; then
    echo "Warning: using Bun $ACTUAL_VERSION; the pin is $PINNED_VERSION. CI runs the pin." >&2
  fi
  echo "Warning: mise is not installed, so tools other than Bun were not installed." >&2
  BUN=(bun)
fi

# Shared dependencies allow one worktree's install to mutate another's toolchain.
if [[ -L node_modules ]]; then
  echo "Error: node_modules is a symlink. Use independent dependencies in this checkout." >&2
  exit 1
fi

"${BUN[@]}" install --frozen-lockfile

# Git hooks cover plain-Git use. CI runs the same checks directly.
# lefthook refuses to install when core.hooksPath is set. That setting is the
# contributor's own, so warn and carry on instead of aborting the bootstrap.
if [[ -z "${CI:-}" ]]; then
  if ! "${BUN[@]}" x lefthook install; then
    echo "Warning: Git hooks were not installed. Run bun run check before pushing." >&2
  fi
fi

echo "Dependencies are ready. Run bun run check to verify this checkout."
