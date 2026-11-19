# The Markdown standard

Outfitter repositories share one set of Markdown rules. It lives in `packages/cinch/presets/rumdl.toml`, in the format [rumdl](https://rumdl.dev) reads, so rumdl applies it with or without Cinch.

## Adopt it

Put one line at the top of the repository's `.rumdl.toml`:

```toml
extends = "packages/cinch/presets/rumdl.toml"
```

rumdl resolves a relative path from the config file's own directory. It also accepts `~/`, an absolute path, and `$VAR` or `${VAR}`. It makes no network requests, so the file must be on disk. How other repositories will reach the file is not settled yet. This repository uses the path above.

## Change it for one repository

Whatever the repository sets after the `extends` line wins over the standard.

- A rule's own table merges key by key. Setting `indent` under `[MD007]` changes only that key.
- `disable` replaces the standard's list. To switch off one more rule and keep the rest, use `extend-disable`.

```toml
extends = "packages/cinch/presets/rumdl.toml"

[global]
extend-disable = ["MD024"]
```

`rumdl config` prints every setting with the file it came from.

## What it sets

- Prose is not hard-wrapped, so line length is not checked. Trailing punctuation in headings, inline HTML, emphasis used as a heading and a first line that is not a heading are allowed.
- Headings use `#`, lists use `-` and indent by two spaces, emphasis uses `*`, and code blocks are fenced.
- An ordered list is either all `1.` or counts up.
- Every code block names a language, and a document uses one spelling for each language.
- List items are tight, and a continuation paragraph may stand apart.
- Two headings may share text unless they are siblings.

## Fenced code

The standard turns on rumdl's code block tools for TypeScript and JavaScript fences, including TSX and JSX. rumdl hands each block to `bun fmt`, which reads the repository's own formatter config.

- `check` reports a block that is not formatted, under a rule such as `bun-fmt:ts`. rumdl marks that finding as not fixable, but `fix` does rewrite the block.
- A block that does not parse cannot be formatted. rumdl stops reading the file at that block, so Cinch reports the step as incomplete and names the line. Make the block valid, or give it a tag that is not formatted, such as `text`.
- A missing `bun` is a failure. The standard sets `on-missing-tool-binary = "fail"`, because rumdl's default is to warn and pass.
- rumdl refuses to run `bun fmt` in a repository whose `package.json` has a script named `fmt`, because Bun would run that script instead of its formatter. Rename the script.

This was checked against rumdl 0.3.5 and Bun 1.4.4.
