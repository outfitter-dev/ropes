# Package verification

Ropes currently ships Bun-compatible ESM TypeScript source. The core exports and the `rope` shebang require Bun 1.4.4 or newer. Keeping source preserves the preset and rule asset paths already used by the engine. A compiled package build can follow when another runtime or consumer requires it.

`@ropes/core` contains the source, presets, rule packs, and config schema. Its package allowlist excludes tests, development scripts, and the legacy Cinch entry point. The repository still runs Cinch through `bun run cinch`. `@ropes/cli` contains its source entry point and depends on the exact core version recorded when Bun packs the workspace dependency.

Run `bun run check:packed` after installing the locked dependencies. CI runs the same command. It packs both packages into a temporary directory, checks the file contents, runs pinned publint against both tarballs, and runs Are The Types Wrong against core's exported ESM types. The ESM-only profile matches the package's declared module format.

The gate then installs both local tarballs in a clean project outside the workspace. It rejects links outside that install, verifies the CLI's exact core dependency, executes `rope --version`, and compares `rope explain --json` with a plan returned through the public core API. Installation can fetch third-party dependencies from the registry. The explanation and API comparison use the installed local packages.

The packages remain private. The gate creates local tarballs and removes its temporary directory after verification.

The same external install includes a private fixture with one `outfitter` executable and an exact core dependency. The fixture delegates `explain`, `check`, and `fix` through `@ropes/core`. It compares plans and provenance for inherited, overridden, and excluded paths, versioned check results for exits 0/1/2, and a dry-run fix against `rope`. The proof checks the tree before applying the repair through `outfitter`, then checks the repaired file through both commands. `outfitter --version` reports both the fixture version and its exact core version.
