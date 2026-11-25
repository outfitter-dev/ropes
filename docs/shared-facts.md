# Shared facts

Some facts about text files are stated in more than one place. The line width is in the `[editor]` table of the Ropes config, and a Markdown linter has a setting of its own for it. When the two say different things, each tool is right by its own config and the repository is wrong. `rope check` reports that as a finding. This is provisional, like the plan it is part of.

## What is compared

The facts are the ones the [`[editor]` table](editor-settings.md) can state, by the same names: `line_width`, `indent_size` and the rest. An adapter says in its descriptor which of them its tool has a setting for. On a run, Ropes asks each such adapter what its tool resolves, and for each value, which file sets it.

- A value a file sets is compared with what `[editor]` states for all files. A difference is one finding, on the file that sets the differing value, and the message names both settings.
- When `[editor]` does not state the fact, the tools are compared with each other. The first one asked is the reference.
- A tool's built-in default is not compared. Nobody stated it, so there is nothing to disagree with.
- The per-glob entries under `[[editor.overrides]]` are not compared yet.

```text
.rumdl.toml
  1:1  error  shared-fact/line_width  .rumdl.toml sets `global.line-length` to 120, but rope.toml sets `editor.line_width` to 100. Both state line_width, so they have to agree. Change one of them.  [rumdl]
```

Ropes cannot tell which side is right, so the finding is not fixable. Change one of the two settings.

The comparison knows a fact only by its name. Which tool has which setting, and how to ask it, stays inside that tool's adapter.

## When it runs

`rope check` and `rope fix` compare the facts after their steps, for every adapter that has a step in the plan. So `rope check README.md` compares what the Markdown linter resolves, and `rope check rope.toml` does not. `rope doctor` inspects settings for the active tools in the workspace plan, alongside the setup and tool availability checks. `rope doctor --fix` and its dry run report the outcome of setup repair.

Doctor's `settings` field records the policy values, the tool observations, their source evidence and limitations, and any drift findings. Human output shows the same information. A differing observed value produces exit 1. A required tool or settings query that cannot run produces exit 2. A config-read value retains its verification limit, including when it agrees with the policy.

`rope explain` shows what a run would compare, after the files:

```text
Shared facts
  stated
    line_width = 100  (rope.toml: editor.line_width)
  compared with
    rumdl  reports line_width
```

An adapter whose tool has such settings but cannot print what it resolves is listed there too, with a line that says its settings are not compared. A tool that was asked and could not answer, for example because its config does not parse, leaves the run incomplete. It is never counted as agreeing.

## Which tools report

| Adapter | Facts | How |
| --- | --- | --- |
| `rumdl` | `line_width` | `rumdl config`, which prints each setting with the file it came from. The rule's own `MD013.line-length` counts when it differs from `global.line-length`. |
| `bun-fmt` | `line_width` | Bun selects the active config for each selected path. Ropes reads `printWidth` from a supported static compatibility config or `fmt.printWidth` from the selected `bunfig.toml`. |

Reported facts carry their evidence. A value printed by the engine is `engine-confirmed`. A value read from a config file selected by the engine is `config-read`. Bun does not print its resolved options, so the formatter's report also states that limit. Dynamic configuration, per-file formatter overrides, and values that may come from `.editorconfig` carry an explicit limitation when Ropes cannot establish them. Older fact reports can omit the evidence field.

Taplo is only used to lint, and its lint reads none of these facts, so it reports nothing.

Settings are not the only way tools disagree. A lint rule and the formatter can undo each other while they run, and `rope fix` [reports that as a conflict](fix.md#when-two-steps-undo-each-other).
