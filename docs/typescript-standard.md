# The TypeScript standard

Cinch ships three presets for a TypeScript repository: one for the linter, one for the formatter and one for the compiler. Each is a file Cinch keeps under `.outfitter/configs/presets/`. The repository's own config extends it, so plain `oxlint`, `oxfmt`, `tsc` and an editor read the same rules Cinch does.

## Switch them on

The three presets are off until the Cinch config asks for them, because not every repository is TypeScript.

```toml
[lint]
preset = true

[format]
preset = true

[typescript]
preset = true
```

Each table is separate, so a repository can take one without the others. Then run `cinch doctor --fix`, or `cinch preset add lint` for one of them. `cinch preset` lists a preset that is not asked for as `off`.

## The files

| Preset | Kept file | What it holds |
| --- | --- | --- |
| `lint` | `.outfitter/configs/presets/oxlint.ts` | The Ultracite core rules, type-aware linting, the Node and Bun globals |
| `format` | `.outfitter/configs/presets/oxfmt.ts` | The Ultracite formatter settings, and prose that is never hard-wrapped |
| `typescript` | `.outfitter/configs/presets/tsconfig.json` | The strict compiler options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and the rest |

Each file starts with a comment that says Cinch manages it. `cinch check` and `cinch doctor` report a copy that is missing or was edited, and `cinch doctor --fix` rewrites it. `cinch fix` never writes it.

The lint and formatter presets import from `ultracite`, so the repository needs `ultracite`, `oxlint` and `oxfmt` as dev dependencies.

## Extend them

The root configs stay the repository's own. Cinch does not write them yet, so add the lines by hand.

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";

import preset from "./.outfitter/configs/presets/oxlint.ts";

export default defineConfig({
  extends: [preset],
  // This repository's own rules go here.
});
```

```ts
// oxfmt.config.ts
import { defineConfig } from "oxfmt";

import preset from "./.outfitter/configs/presets/oxfmt.ts";

export default defineConfig({ ...preset });
```

```json
{
  "extends": "./.outfitter/configs/presets/tsconfig.json",
  "include": ["packages/*/src/**/*.ts"]
}
```

The compiler preset states no `include`, because which files are the project is the repository's to say. Add the kept `.ts` presets to `include` when the config files themselves are type checked.

## Run the linter, the type check and the formatter

Keeping a preset and running a tool are separate switches. To have `cinch check` and `cinch fix` run Oxlint, the type check and the formatter, name the files in `include` and switch them on:

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

`cinch explain <file>` then shows the steps, and [adapters](adapters.md) says how each runs. The formatter also formats the Markdown and TOML files `include` names.

## Not yet

- Cinch does not yet check that a root config extends the kept copy.
- There are no `[tools.oxlint]` or `[tools.oxfmt]` tables and no generated layer between the preset and the root config, as Markdown has.
- Cinch does not yet check that the installed `ultracite` is the version the presets were written for.
