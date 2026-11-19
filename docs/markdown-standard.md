# The Markdown standard

Outfitter repositories share one set of Markdown rules. It lives in `packages/cinch/presets/rumdl.toml`, in the format [rumdl](https://rumdl.dev) reads, and ships inside Cinch. A Cinch version is therefore also a version of the standard.

## How a repository gets it

Cinch keeps two files in the repository. Both are committed.

- `.outfitter/configs/rumdl.toml` is a copy of the standard. Cinch owns it. Do not edit it, because `cinch fix` rewrites it.
- `.rumdl.toml` is the repository's own config. Its first line extends the copy, and everything after that line is the repository's to change.

```toml
extends = ".outfitter/configs/rumdl.toml"
```

`cinch check` reports the copy when it is missing or differs from what this Cinch ships, and reports `.rumdl.toml` when it does not extend the copy. `cinch fix` writes the copy, creates `.rumdl.toml` when there is none, and adds the `extends` line to one that has none. `cinch explain` lists both files like any other. The copy is on disk, so running rumdl by hand applies the same rules.

Cinch leaves a `.rumdl.toml` that already extends something else alone and reports it. Change the line by hand, or opt out. It also will not write `.rumdl.toml` when the repository configures rumdl in `rumdl.toml`, `.config/rumdl.toml` or `pyproject.toml`, because rumdl reads only one of them and the new file would hide those settings. Move them into `.rumdl.toml` first.

A fix writes these two files before it touches any Markdown, so the first run already uses the standard.

## Take a newer standard

Update Cinch, run `cinch preset update` or `cinch fix`, and review the diff of `.outfitter/configs/rumdl.toml`. Until then `cinch check` fails, so a repository cannot drift from the Cinch it pins without someone seeing it.

## Opt out

```toml
[markdown]
preset = false
```

With that in the Cinch config, Cinch keeps neither file and rumdl uses whatever config the repository has.

## Change it for one repository

Whatever the repository sets after the `extends` line wins over the standard.

- A rule's own table merges key by key. Setting `indent` under `[MD007]` changes only that key.
- `disable` replaces the standard's list. To switch off one more rule and keep the rest, use `extend-disable`.

```toml
extends = ".outfitter/configs/rumdl.toml"

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
- Heading anchors are unique across H1 to H3, compared the way GitHub builds them.
- A heading has content before the next heading. A heading followed by its own subheading counts.
- A heading carries no bold or emphasis. Inline code in a heading is fine.
- A code block that shows a fence uses a longer fence of its own.
- Continuation lines of a paragraph are not indented.
- A rumdl disable comment has to suppress something, and a link destination holds no look-alike non-ASCII characters.

## Fenced code

The standard turns on rumdl's code block tools for TypeScript and JavaScript fences, including TSX and JSX. rumdl hands each block to `bun fmt`, which reads the repository's own formatter config.

- `check` reports a block that is not formatted, under a rule such as `bun-fmt:ts`. rumdl marks that finding as not fixable, but `fix` does rewrite the block.
- A block that does not parse cannot be formatted. rumdl stops reading the file at that block, so Cinch reports the step as incomplete and names the line. Make the block valid, or give it a tag that is not formatted, such as `text`.
- A missing `bun` is a failure. The standard sets `on-missing-tool-binary = "fail"`, because rumdl's default is to warn and pass.
- rumdl refuses to run `bun fmt` in a repository whose `package.json` has a script named `fmt`, because Bun would run that script instead of its formatter. Rename the script.

This was checked against rumdl 0.3.5 and Bun 1.4.4.
