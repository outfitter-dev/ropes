# Package verification

Ropes currently ships Bun-compatible ESM TypeScript source. The core exports and the `rope` shebang require Bun 1.4.4 or newer. Keeping source preserves the preset and rule asset paths already used by the engine. A compiled package build can follow when another runtime or consumer requires it.

`@ropes/core` contains the source, presets, rule packs, and config schema. Its package allowlist excludes tests, development scripts, and the legacy Cinch entry point. The repository still runs Cinch through `bun run cinch`. `@ropes/cli` contains its source entry point and depends on the exact core version recorded when Bun packs the workspace dependency.

Run `bun run check:packed` after installing the locked dependencies. CI runs the same command. It packs both packages into a temporary directory, checks the file contents, runs pinned publint against both tarballs, and runs Are The Types Wrong against core's exported ESM types. The ESM-only profile matches the package's declared module format.

The gate then installs both local tarballs in a clean project outside the workspace. It rejects links outside that install, verifies the CLI's exact core dependency, executes `rope --version`, and compares `rope explain --json` with a plan returned through the public core API. Installation can fetch third-party dependencies from the registry. The explanation and API comparison use the installed local packages.

The gate creates local tarballs and removes its temporary directory after verification. The fixture installs resolve the CLI's transitive core dependency from the matching local tarball, so the gate can test a version before it exists on the registry. The installed CLI still has to declare the exact core version in its own manifest. To retain the two checked archives, set `ROPES_PACKED_OUTPUT` to a new directory.

The same external install includes a private fixture with one `outfitter` executable and an exact core dependency. The fixture delegates `explain`, `check`, and `fix` through `@ropes/core`. It compares plans and provenance for inherited, overridden, and excluded paths, versioned check results for exits 0/1/2, and a dry-run fix against `rope`. The proof checks the tree before applying the repair through `outfitter`, then checks the repaired file through both commands. `outfitter --version` reports both the fixture version and its exact core version.

A separate unrelated repository exercises [portable enforcement](portable-enforcement.md) through the packed CLI. Its checks use a small environment and only the engines required by the selected policy. The proof covers neutral compatibility policy, UTC transitions, a repository-owned rule, explicit shipped-preset adoption, exclusions, and preservation of repository files and the Git index.

To rehearse a candidate version locally, set both package manifest versions and the exact core pin in `packages/cli/tests/fixtures/outfitter/package.json` to that version in a disposable checkout, then run `bun run check:packed`. The portable fixture uses Bun's isolated linker and installs the CLI directly, so it can verify a transitive core install without a root-level core link.

## npm pilot

The first candidate is `@ropes/core@0.1.0-pilot.0` and `@ropes/cli@0.1.0-pilot.0`. Both tarballs contain the MIT license. The workflow submits packages under `pilot`. npm does not issue provenance for the internal source repository.

Dispatch the **npm release** workflow on `main` with `prepare` to produce the verified tarball pair and its SHA-256 manifest. Review the exact source commit and archive hashes before staging.

Configure each npm package's GitHub trusted publisher for organization `outfitter-dev`, repository `ropes`, and workflow `npm-release.yml`. Use stage-only permissions. After artifact approval, dispatch `core` and then `cli` using the same artifact ID and each package's approved hash. Each dispatch submits one reviewed tarball. If one submission succeeds and the other fails, retry only the missing package using the same artifact.

Approve the staged core before the staged CLI in npm with 2FA. In a clean Git checkout with an initial commit, install the approved version and check the launcher.

```sh
bun add --dev --exact @ropes/cli@0.1.0-pilot.0
./node_modules/.bin/rope --version
```

Verify that both `pilot` tags resolve to the approved version before passing the pin to Forge. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) · [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
