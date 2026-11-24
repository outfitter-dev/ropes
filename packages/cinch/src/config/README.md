# config

The pilot config loader reads `rope.toml` and reports the file and key behind each value. A repository without a policy uses the defaults. Retired policy and managed paths are detected separately so the CLI can explain how to migrate them.

The file must state `pilot = 0`. A missing or unknown marker is an error, never a silent default. Unknown keys are errors too.

Nothing in this folder may import from `adapters/`, `runner/` or `commands/`.

## Finding the root

`discoverRoot(from)` walks up from a directory to the version-control boundary: the first directory holding `.jj`, a `.git` directory, or the `.git` file of a linked worktree. The nearest directory with `rope.toml` is the root. With no config, the boundary is the root. A config above the boundary is never read, and a directory with no repository above it is an error.

Root discovery checks for retired inputs through the same version-control boundary. Shared policy for other tools leaves Ropes root selection unchanged. Each linked worktree and each jj workspace is its own boundary.

`toRootRelative(root, cwd, selected)` turns a selected path into the root-relative, forward-slash form the plan uses. A path outside the root is an error. Symlinks are resolved on both sides, so a checkout reached through a symlink still matches.
