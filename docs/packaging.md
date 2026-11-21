# Package verification

Ropes currently ships Bun-compatible ESM TypeScript source. The core exports and the `rope` shebang require Bun 1.4.4 or newer. Keeping source preserves the preset and rule asset paths already used by the engine. A compiled package build can follow when another runtime or consumer requires it.

`@ropes/core` contains the source, presets, rule packs, and config schema. Its package allowlist excludes tests, development scripts, and the legacy Cinch entry point. The repository still runs Cinch through `bun run cinch`. `@ropes/cli` contains its source entry point and depends on the exact core version recorded when Bun packs the workspace dependency.

Run `bun run check:packed` after installing the locked dependencies. CI runs the same command. It packs both packages into a temporary directory, checks the file contents, runs pinned publint against both tarballs, and runs Are The Types Wrong against core's exported ESM types. The ESM-only profile matches the package's declared module format.

The gate then installs both local tarballs in a clean project outside the workspace. It rejects links outside that install, verifies the CLI's exact core dependency, executes `rope --version`, and compares `rope explain --json` with a plan returned through the public core API. Installation can fetch third-party dependencies from the registry. The explanation and API comparison use the installed local packages.

The gate creates local tarballs and removes its temporary directory after verification. The fixture installs resolve the CLI's transitive core dependency from the matching local tarball, so the gate can test a version before it exists on the registry. The installed CLI still has to declare the exact core version in its own manifest. To retain the two checked archives, set `ROPES_PACKED_OUTPUT` to a new directory.

The same external install includes a private fixture with one `outfitter` executable and an exact core dependency. The fixture delegates `explain`, `check`, and `fix` through `@ropes/core`. It compares plans and provenance for inherited, overridden, and excluded paths, versioned check results for exits 0/1/2, and a dry-run fix against `rope`. The proof checks the tree before applying the repair through `outfitter`, then checks the repaired file through both commands. `outfitter --version` reports both the fixture version and its exact core version.

A separate unrelated repository exercises [portable enforcement](portable-enforcement.md) through the packed CLI. Its checks use a small environment and only the engines required by the selected policy. The proof covers neutral compatibility policy, UTC transitions, a repository-owned rule, explicit shipped-preset adoption, exclusions, and preservation of repository files and the Git index.

To rehearse a candidate version locally, set both package manifest versions and the exact core pin in `packages/cli/tests/fixtures/outfitter/package.json` to that version in a disposable checkout. Set `publishConfig.tag` in both package manifests to the intended channel, then run `bun run check:packed`. The portable fixture uses Bun's isolated linker and installs the CLI directly, so it can verify a transitive core install without a root-level core link.

## npm release

The published pilot is `0.1.0-pilot.0`. Prepare `0.1.0-canary.0` as the first opt-in `canary` release. The proposed stable pair is `0.1.0` under `latest`, after the canary has a clean install and consumer checks. Use `0.1.0-canary.1` for a new candidate if the first canary needs changes. Keep each published version immutable and both packages on the same version and channel.

Dispatch the **npm release** workflow on `main` with `prepare` to produce the verified pair and its SHA-256 manifest. Review the source commit, version, channel, and both hashes before staging. The workflow checks the artifact’s origin and digest before it will stage a tarball. The archive’s manifest binds its version to the `canary` or `latest` channel. The internal source repository uses trusted publishing without npm provenance.

Each npm package trusts `outfitter-dev/ropes` and `npm-release.yml` with stage-only permissions. After artifact approval, dispatch `core` and then `cli` with the same artifact ID and each package's approved hash. If one submission succeeds and the other fails, retry only the missing package with the same artifact. Approve core before CLI in npm with 2FA.

After both approvals, verify that both target tags point to the approved version and the published archive hashes match. Install the exact version in a clean Git checkout with an initial commit and check the launcher.

```sh
bun add --dev --exact @ropes/cli@0.1.0-canary.0
./node_modules/.bin/rope --version
```

Test the canary in a disposable consumer checkout before proposing a Forge pin change. Forge keeps its qualified exact pin until the replacement passes its checks. Keep `pilot` available during the move. If a release needs recovery, consumers can restore the previous exact pins. Any registry tag rollback uses the recorded previous targets and needs approval. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) · [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
