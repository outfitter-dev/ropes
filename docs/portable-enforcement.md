# Use Ropes in an ordinary repository

An installed Ropes CLI can check a repository with its own policy, tool pins and ordinary Git history. The packed acceptance proof runs outside the Ropes source checkout, with an environment containing only temporary home/cache directories and the executables needed by each selected rule.

The fixture uses the exact `@ropes/core` and `@ropes/cli` tarballs built by `bun run check:packed`. It installs those local files first, then records the verified exact CLI version in the unrelated repository manifest. Package installation is setup. Each check uses the existing installation and an explicit engine pin. The CLI prints its installed version and resolved entry path.

## Select a neutral compatibility rule

This repository-owned policy checks direct imports of the TypeScript `Map` API removed in 5.0. It supplies its own deadline.

```toml
pilot = 0
include = ["api/**/*.ts"]
exclude = ["**/node_modules/**", "excluded/**"]

[markdown]
enabled = false
preset = false
[toml]
enabled = false

[rules]
enabled = true
packs = ["typescript-api"]

[rules.enforcement]
"typescript-api/removed-map" = "2099-02-01"
```

The package at `api/package.json` declares its support target with `"peerDependencies": { "typescript": "^5.0.0" }` and installs matching TypeScript declarations. Its plain `tsconfig.json` selects `moduleResolution = "bundler"`. The [compatibility pilot](compatibility.md) records the supported compiler configuration and import forms.

```sh
rope explain api/index.ts --at 2099-01-31T23:59:59.999Z --json
rope check api/index.ts --at 2099-01-31T23:59:59.999Z --json
rope check api/index.ts --at 2099-02-01T00:00:00.000Z --json
```

The same import is advisory just before the deadline and blocking at the boundary. Both reports identify the selected file, package manifest, authored policy, evaluation time and native diagnostic. These historical or future clock inputs are simulated previews. A target entirely below 5.0 makes the compatibility rule inapplicable. A required checker missing from `PATH` yields exit 2. An excluded path has no rule or deadline obligation. Bun is the only checker needed for this adopted rule, and the TypeScript declarations are a package dependency.

## Add a repository-owned rule

A local rule can use ast-grep without adopting a shipped pack. Save this file as `rules/no-debugger.yml`.

```yaml
id: no-debugger
language: typescript
severity: error
message: Remove the debugger before sharing this code.
rule:
  pattern: debugger
```

Name `local = ["rules"]` and `enabled = true` under `[rules]`. The finding carries `local/no-debugger`, and the plan traces its folder to `rope.toml`. This example needs the pinned ast-grep engine. The `config` pack and TypeScript preset supplied by Ropes appear in a separate explicit-adoption case in the proof, so a maintainer can inspect the policy added by that choice.

## Reproduce the proof

Run `bun run check:packed` with the tools pinned in `mise.toml`. The gate builds and validates both package archives, installs them into a disposable repository, and invokes that installed `rope`. The neutral rule receives only Bun and Git on `PATH`; the local-rule and shipped-preset examples receive only ast-grep and Git. Check subprocesses receive no inherited service credentials or source-workspace environment. Ropes needs Git to verify the installed launcher belongs to the checkout.

The gate verifies matching `explain` and `check` plans, human and JSON verdicts, package applicability, UTC transitions, exclusions, missing-engine failure and explicit adoption. It compares repository files and the Git index before and after every invocation. The exact API declarations used by the fixture are TypeScript 5.0.4 from the workspace lockfile. It performs no publication or changes to a live adopter repository.
