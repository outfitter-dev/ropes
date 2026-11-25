# Delegation

Delegation records work a repository hands to another tool, with the paths and domains that tool owns.

```toml
[delegates.biome]
domains = ["lint", "format"]
paths = ["src/**"]
config = ["biome.json", ".editorconfig"]

[delegates.actionlint]
paths = [".github/workflows/**"]
```

A tool name is a label. It can name a tool Ropes has no adapter for. Omitting `domains` hands over every domain on matching paths. Supported domains are `markdown`, `toml`, `lint`, `format`, `typescript`, `rules`, `editor` and `install`. A formatter adapter can cover both its own policy domain and `format`, so delegating either leaves that adapter out. Explicitly enabling a delegated domain with a matching override is a configuration error.

`explain` records each selected path's external owner and authored setting. Version 6 check results carry the same scope under `plan.paths[].delegated`, and human output counts delegated selected paths. Ropes gives this scope no check verdict. Delegated paths stay visible even when the default `include` does not name their file type. Explicit `exclude` still leaves a path out.

`config` names exact root-relative files without globs or parent segments. Every Ropes verb preserves these files, independently of the delegated paths and domains. Protection follows symbolic links and existing hard links, including aliases reached through directory selections. Config paths reject control characters. Setup inspection asks for no preset or `extends` repair there. Content checks may read them. If a delegate lists `.editorconfig`, the authored file takes precedence over generation from `[editor]`, and Ropes leaves it untouched even when the table and file disagree. Remove it from `config` to return ownership to Ropes.

A protected root config can still consume a generated `[tools.<tool>]` table through an existing connection. Ropes verifies that connection by reading the root config alone. A disconnected protected root with an active tool table is a configuration error. Move the settings into the authored native config or connect it to the generated settings manually.

When an adapter can read a delegated tool's shared settings for the delegated domains, Ropes still compares those settings with `[editor]` and other tools. The comparison carries configuration evidence and can report drift. It establishes no file check coverage.

Tests, builds and deploy checks stay in the task runner. Keep running delegated tools from repository scripts, hooks or CI.

Output version 6 requires consumers to validate the new scope evidence. Current qualification rejects version 5 and earlier plans and results. The offline repair reader preserves archived version 5 and earlier observations and their original finding IDs.
