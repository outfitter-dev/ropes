# Adopt Ropes in a repository

Pin a qualified Ropes version, preview its setup and findings in a disposable checkout, and record the policy and engine versions used. The repository owner decides which files and rule packs to adopt. Ropes works with ordinary tools and CI.

1. Install the exact CLI and required engines. Use the [launcher guide](launcher.md) for npm pins or the [standalone guide](binary.md) for a repository without Bun.
2. Run `rope init` in a fresh repository. Convert retired policy manually with the [migration guide](config-migration.md), then preview managed setup with `rope doctor --fix --dry-run`.
3. Review `rope explain --json` and `rope check --json` for the intended scope. Missing required engines and unresolved checks exit 2.
4. Review and apply setup and content fixes in focused changes. Use `rope fix --dry-run` before `rope fix`, then rerun the full selected scope. Adopt additional rule packs with `rope rules adopt`.
5. Add the pinned `rope check` command to the repository's existing gate and check its exit code. Keep any explicit staged-adoption allowance in policy and verify the full scope when cleanup completes.

Each adoption should record the source revision, policy, selected files, engine pins, findings, and any incomplete checks. Historical trial counts below can help identify cases to exercise, and a fresh run supplies the adoption evidence.

## Historical pilot record · November 19, 2026

The following inventory records the Cinch pilot before the Ropes cutover. Its command names, source paths, counts, implementation notes, and proposed order describe that trial. Use the current steps above when adopting Ropes.

This repository is the first pilot. It has run `cinch check` in its own gate since the first day the command worked, and the first run selected 8 Markdown files and found nothing. This page lists the other repositories, what each one needs before Cinch can replace its current Markdown checks, and the order to do them in.

### How the numbers were made

On 2026-11-19 each repository was cloned into a temporary directory, `cinch init --yes` was run in the clone, and then `cinch check --json`. Nothing was changed in the repositories themselves. Read the numbers with three limits in mind:

- The clones were the copies this session had on disk. Most were current to within two days. `monorepo`, `dispatch`, `biner` and `actions` were older, and are marked.
- No dependencies were installed in the clones. A repository whose formatter config is a TypeScript file that imports a package could not format its fenced code, and those steps came back incomplete. They are counted separately below.
- The old `ignores` lists were not applied. When the trial ran, `cinch init` did not yet write them into `cinch.toml`. It does now, so a rerun will give lower numbers. Counts for `trails` and `skillset` include changelogs and generated files that those repositories ignore today.

### What each repository needs

| Repository | Markdown files checked | Checks Markdown today with | Trial findings | Incomplete steps | Before Cinch can take over |
| --- | --- | --- | --- | --- | --- |
| `climb` | 7 | oxfmt only | 0 | 0 | Nothing. Add the config and the gate step. |
| `equip` | 11 | nothing | 0 | 0 | Nothing. |
| `homebrew-tap` | 1 | markdownlint-cli2 config, no script | 0 | 0 | Remove the old config. |
| `camp` | 5 | nothing | 1 (MD040) | 0 | Name the language on one fenced block. |
| `biner` (clone from August) | 31 | markdownlint-cli2 script and pre-commit hook | 2 (MD032) | 0 | Swap the script and the hook, remove the old config and dependency. |
| `forge` | 42 | oxfmt only | 0 | 5 | Installed dependencies, so `oxfmt.config.ts` loads. Then expected clean. |
| `ranger` | 57 | oxfmt only | 32 (MD049 24, MD028 6) | 0 | One mechanical fix for emphasis style. |
| `monorepo` (clone from September) | 10 | markdownlint-cli2 script and hook | 34 (MD049 29, MD076 5) | 0 | One mechanical fix, then swap the script and hook. |
| `actions` (clone from January) | 34 | markdownlint-cli2 config, no script | 85 (MD022 23, MD032 23, MD031 15) | 3 | A mechanical fix. |
| `dispatch` (clone from September) | 157 | nothing | 319 (MD022 162, MD032 81, MD025 27) | 0 | A way to install Cinch in a Python repository, and a decision on whether `.agents/goals` and `.agents/plans` (255 of the findings) are checked at all. |
| `skillset` | 520 | nothing in hooks | 567 (MD080 144, MD032 90, MD022 72) | 3 | Excludes for generated output and `.agents/plans` (254 findings), installed dependencies, then a mechanical fix. |
| `trails` | 596 | markdownlint-cli2 `--fix` in pre-commit | 1,285 (MD080 718, MD082 334, formatting of fenced TypeScript 163) | 44 | The old ignores carried into `cinch.toml` (changelogs account for most of MD080 and MD082), then a mechanical fix. |

Not surveyed: `outpost`, because the copy on disk was the retired gateway and not the current repository. Not in scope: `outfitter-legacy`.

### What the trial found about Cinch

These are gaps in Cinch, not in the repositories. Each one blocks part of the rollout.

1. **Ignores were not carried over.** Closed: `cinch init` now writes a markdownlint-cli2 config's `ignores` and `globs` into the `cinch.toml` it creates. The old rules are also merged into a `.rumdl.toml` that is already there. `cinch init --yes` removes the old config files when everything in them was carried over. `init` also lists what is left of the old linter and does not remove: its ignore file, packages, scripts, hooks and CI steps.
2. **A fenced block that is not valid code made the whole file incomplete.** Documentation often shows a fragment: one object literal, a line with `...` in it, SQL inside a block labelled `typescript`. The formatter cannot parse these. At the time of the trial the step was incomplete and the run exited 2, so the only way to get green was to relabel the fence. `trails` had 44 such files and `actions` had 3. Cinch now reports such a block as a finding under `code-block-parse` and checks the rest of the file (see [the Markdown standard](markdown-standard.md)), so the blocks can be found and fixed one by one. The incomplete counts in the table are from before that change: rerun on the same clones, `trails` has 112 such blocks in 44 files and `actions` has 18 in 3.
3. **The formatter needs the repository's dependencies.** `forge` and `skillset` configure oxfmt in a TypeScript file. Without `node_modules` the config does not load and fenced code cannot be checked. In CI this is fine, since dependencies are installed first. The reason text now says so.
4. **Cinch only installs through Bun.** `dispatch` is a Python repository run with uv. It needs Cinch as a pinned tool it can get without a `package.json`, which is the install question in [FIT-32](https://linear.app/outfitter/issue/FIT-32).

### Order

1. **`forge`.** It is the named pilot, it is expected to be clean, and it proves the pin-and-baseline flow on a repository that is not this one. It waits for the package to be published.
2. **`climb`, `equip`, `homebrew-tap`, `camp`.** Clean or one finding. They prove the same steps repeat with no surprises.
3. **`biner`, `ranger`, `monorepo`.** Small mechanical fixes, and the first real swaps of a markdownlint script and hook. These need the rest of the migration from FIT-41.
4. **`actions`.** A larger mechanical fix, with fenced fragments in three files.
5. **`skillset`.** Large, with generated output to exclude.
6. **`trails`.** Largest, with the most to carry over and a Markdown fix already in its pre-commit hook. It goes last so that every gap above is closed first.
7. **`dispatch`.** Whenever Cinch can be installed without Bun.

Each repository gets two pull requests: one that adds the config, the pinned tool and the gate step with a baseline, and one mechanical pull request that fixes what the first run found. Do not mix them.
