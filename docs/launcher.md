# Repository-pinned rope

An installed `rope` reads the nearest package manifest that explicitly declares `@ropes/cli` in `dependencies` or `devDependencies`. It searches from the current directory up to the Git or jj checkout boundary. A linked worktree has its own boundary. A nested package can declare its own pin, or inherit the root package's pin.

Use one exact version, including a prerelease suffix when needed. Install that dependency with the repository's normal package workflow. Ropes checks the installed package's name, version, launcher protocol, and executable before handing the original arguments to it. Its physical installation and executable must remain inside the current checkout. `rope --version` prints the version that ran and its resolved entry path.

The normal package installation is the trust boundary. Before handing off, Ropes verifies the Git checkout and rejects any `node_modules` content tracked in HEAD or the index, including nested and transitive packages. The CLI and its resolved core runtime must physically resolve inside this checkout's `node_modules` and belong to the same version-control checkout. A committed, staged, or nested-checkout package cannot impersonate the installed tool. Git and colocated jj checkouts use this verification. Gitless jj is currently rejected because a read-only jj file listing can omit pending working-copy tracking changes.

On supported Bun runtimes, the selected CLI replaces the launcher process. A termination signal addressed to the launcher PID therefore reaches the selected run and stops it before a later write batch. A runtime without process replacement reports an error and identifies the local entry to invoke directly.

Missing installations, version ranges, mismatched installed versions, incompatible launcher protocols, and recursive handoffs exit 2 with a recovery instruction. Discovery reads the existing installation. It never installs a dependency. A plain `outfitter` or unrelated `rope` binary cannot satisfy the explicit `@ropes/cli` dependency.

The source workspace retains `bun run rope` for development, where the CLI's core dependency still uses `workspace:*`. Packed artifacts replace that dependency with an exact version and use the repository-pinned launcher contract.

`bun run check:packed` verifies two installed CLI copies, calls from a root and nested package, a linked worktree with its own installation, plan agreement, and the failure cases above. The fixture installs local tarballs before replacing the tarball paths in its test manifest with their verified exact versions. The check performs no registry resolution for those packages.
