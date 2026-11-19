# config

The unstable pilot config loader. `loadConfig(root)` reads the `[cinch]` table in `outfitter.toml` or a standalone `cinch.toml`, and reports the file and key behind every value. Having both is an error. With neither, the defaults apply.

The file must state `pilot = 0`. A missing or unknown marker is an error, never a silent default. Unknown keys are errors too.

Nothing in this folder may import from `adapters/`, `runner/` or `commands/`.
