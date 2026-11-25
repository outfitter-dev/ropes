# The TypeScript standard

Ropes ships three presets for a TypeScript repository: one for the linter, one for the formatter and one for the compiler. Each is a file Ropes keeps under `.ropes/configs/presets/`. The repository's own config extends it, so plain `oxlint`, `oxfmt`, `tsc` and an editor read the same rules Ropes does.

## Switch them on

The three presets are off until the Ropes config asks for them, because not every repository is TypeScript.

```toml
[lint]
preset = true

[format]
preset = true

[typescript]
preset = true
```

Each table is separate, so a repository can take one without the others. Then run `rope doctor --fix`, or `rope preset add lint` for one of them. `rope preset` lists a preset that is not asked for as `off`.

## The files

| Preset | Kept file | What it holds |
| --- | --- | --- |
| `lint` | `.ropes/configs/presets/oxlint.ts` | The Ultracite core rules, type-aware linting, the Node and Bun globals |
| `format` | `.ropes/configs/presets/oxfmt.ts` | The Ultracite formatter settings, and prose that is never hard-wrapped |
| `typescript` | `.ropes/configs/presets/tsconfig.json` | The strict compiler options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and the rest |

Each file starts with a comment that says Ropes manages it. `rope check` and `rope doctor` report a copy that is missing or was edited, and `rope doctor --fix` rewrites it. `rope fix` never writes it.

The lint and formatter presets import from `ultracite`, so the repository needs `ultracite`, `oxlint` and `oxfmt` as dev dependencies.

The presets are written for `ultracite` 8.1.1. `rope check` and `rope doctor` report a finding on a kept preset when `ultracite` is not installed, is older than that, or is another major version. A later release of the same major passes. Ropes does not install it, so the finding is not one `doctor --fix` can clear: install the version the message names.

## Extend them

The root configs stay the repository's own, and each must build on its preset while the preset is on. `rope check` and `rope doctor` report one that does not.

- A root config that is missing is written by `rope doctor --fix`, as the smallest file that uses the preset. It will not write `oxlint.config.ts` beside an `.oxlintrc.json`, or `oxfmt.config.ts` beside an `.oxfmtrc.json`, `.oxfmtrc.jsonc` or `oxfmt.config.mts`. It names the file that is there.
- A `tsconfig.json` with no `extends` gets the key from `rope doctor --fix`, as its first, and nothing else in the file changes. One that already extends something else is reported and left alone, because the order of the two decides which wins: make `extends` a list with the preset first.
- An `oxlint.config.ts` or `oxfmt.config.ts` that does not import the preset is reported with the lines to add. Ropes does not rewrite a module a person wrote. The check is that the import is there. It does not prove the config uses it.

Written by hand, they look like this.

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";

import preset from "./.ropes/configs/presets/oxlint.ts";

export default defineConfig({
  extends: [preset],
  // This repository's own rules go here.
});
```

```ts
// oxfmt.config.ts
import { defineConfig } from "oxfmt";

import preset from "./.ropes/configs/presets/oxfmt.ts";

export default defineConfig({ ...preset });
```

```json
{
  "extends": "./.ropes/configs/presets/tsconfig.json",
  "include": ["packages/*/src/**/*.ts"]
}
```

The compiler preset states no `include`, because which files are the project is the repository's to say. Add the kept `.ts` presets to `include` when the config files themselves are type checked.

## Run the linter, the type check and the formatter

Keeping a preset and running a tool are separate switches. To have `rope check` and `rope fix` run Oxlint, the type check and the formatter, name the files in `include` and switch them on:

```toml
include = ["**/*.md", "**/*.toml", "**/*.ts", "**/*.json"]

[lint]
enabled = true
preset = true

[format]
enabled = true
preset = true

[typescript]
enabled = true
preset = true
```

`rope explain <file>` then shows the steps, and [adapters](adapters.md) says how each runs. The formatter also formats the Markdown and TOML files `include` names.

## Not yet

- There are no `[tools.oxlint]` or `[tools.oxfmt]` tables and no generated layer between the preset and the root config, as Markdown has.
