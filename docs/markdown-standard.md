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

## Moving from markdownlint

rumdl reads a markdownlint config when a repository has no rumdl config. The moment `.rumdl.toml` exists it stops, so adopting the standard would drop the repository's own rules without a word. Cinch carries them over instead. When it creates `.rumdl.toml` and finds a markdownlint config, it writes the rules that differ from the standard below the `extends` line:

```toml
extends = ".outfitter/configs/rumdl.toml"

# Carried over from .markdownlint.json by Cinch.
# Only what differs from the Markdown standard is here.
[global]
extend-disable = ["MD001"]

[MD007]
indent = 4

# Not carried over from .markdownlint.json:
# - `my-rule` is not a rule the new linter has. It may be a custom rule or a tag.
```

`cinch init` shows this as a diff before anything is written, like every other change it makes.

- Cinch reads the rules the old linter would have used. A `.markdownlint.jsonc`, `.json`, `.yaml` or `.yml` file comes first, in that order, because it replaces the `config` block of a markdownlint-cli2 file beside it. Without one, the rules are the `config` block of `.markdownlint-cli2.jsonc`, `.markdownlint-cli2.yaml` or the `markdownlint-cli2` key in `package.json`. Any file that was not read is named in the notes.
- The translation is rumdl's own (`rumdl import`). Cinch then compares rules by ID, so `no-inline-html` and `MD033` are the same rule, and drops every value the standard already sets and every value rumdl added that the old config did not state. An option rumdl renames, such as `stern` to `strict` on MD013, is carried under its new name. When a rule appears under two names, the last entry counts.
- A rule the old config switched off stays off, under `extend-disable`. A rule the standard switches off that the old config configured or switched on stays on. Then `disable` replaces the standard's list and repeats what stays off. A config with `default: false` becomes an `enable` list of the rules it switched on, and the rules the standard adds are switched off beside it.
- What cannot be carried over is listed in a comment by name: custom rules and tags, `extends`, and markdownlint-cli2 settings such as `customRules`. `globs` and `ignores` choose files, which is the Cinch config's job. When `cinch init` writes the first `cinch.toml`, it puts `ignores` and negated `globs` there as `exclude`, and other `globs` as `include`, unless they only say `**/*.md`. The old linter reads a pattern that names a directory, such as `dist`, as everything under it, so that pattern is written twice: `dist` and `dist/**`. A pattern a Cinch glob cannot say, such as an absolute path or an extended glob, is named in a comment and not written. A `cinch.toml` that is already there is left alone, and the note in `.rumdl.toml` says to add the lines by hand. `gitignore` needs no line: Cinch already leaves out the files git ignores.
- A config that is a script, such as `.markdownlint.cjs`, is never run. Cinch reports it and does not create `.rumdl.toml`. Write the file by hand.
- The translation needs rumdl on `PATH`. Without it the step is incomplete and nothing is written.
- An existing `.rumdl.toml` is not touched by this. Cinch does not remove the old config, its ignore file, its dependency or the scripts that call it. Do that once the new file reads right.

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
- A block that does not parse cannot be formatted, and it is a finding. Cinch reports it under the rule `code-block-parse` at the line the block starts on, with the parser's message, and the run exits 1. `fix` cannot repair it. Every other block in the file is still checked and fixed. Make the block valid, or give it a tag that is not formatted, such as `text`. `code-block-parse` is Cinch's own rule name, because rumdl prints a warning for such a block and gives it no rule.
- Any other failure of the formatter is incomplete. That covers a formatter config that does not load, which usually means the repository's dependencies are not installed. The standard sets `on-error = "warn"` so that rumdl goes on to the next block, and Cinch reads each warning to tell the two cases apart. A repository that sets `on-error` back to `fail` gets the earlier behavior: the step is incomplete at the first block that fails.
- A missing `bun` is a failure. The standard sets `on-missing-tool-binary = "fail"`, because rumdl's default is to warn and pass.
- rumdl refuses to run `bun fmt` in a repository whose `package.json` has a script named `fmt`, because Bun would run that script instead of its formatter. Rename the script.

This was checked against rumdl 0.3.5 and Bun 1.4.4.
