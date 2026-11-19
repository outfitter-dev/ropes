# config

The unstable pilot config loader. `loadConfig(root)` reads the `[cinch]` table in `outfitter.toml` or a standalone `cinch.toml`, and reports the file and key behind every value. Having both is an error. With neither, the defaults apply.

The file must state `pilot = 0`. A missing or unknown marker is an error, never a silent default. Unknown keys are errors too.

Nothing in this folder may import from `adapters/`, `runner/` or `commands/`.

## Finding the root

`discoverRoot(from)` walks up from a directory to the version-control boundary: the first directory holding `.jj`, a `.git` directory, or the `.git` file of a linked worktree. The nearest directory on the way that configures Cinch is the root. With no config, the boundary is the root. A config above the boundary is never read, and a directory with no repository above it is an error.

An `outfitter.toml` counts only when it has a `[cinch]` table, so a nested one that configures other tools does not hide the config above it. Each linked worktree and each jj workspace is its own root.

`toRootRelative(root, cwd, selected)` turns a selected path into the root-relative, forward-slash form the plan uses. A path outside the root is an error.
