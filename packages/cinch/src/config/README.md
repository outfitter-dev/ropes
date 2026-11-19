# config

The unstable pilot config loader lands here (FIT-7). It reads `cinch.toml`, and a `[cinch]` table in `outfitter.toml`, and reports where each value came from. Nothing in this folder may import from `adapters/`, `runner/` or `commands/`.
