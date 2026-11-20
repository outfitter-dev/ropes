# Preview a Cinch config migration

Run `rope migrate` in a repository with `cinch.toml` or a `[cinch]` table in `outfitter.toml`. The command shows the proposed `rope.toml` and the managed files and root tool references that would move from `.outfitter/configs/` to `.ropes/configs/`. Use `--json` to read the same report in an integration. The command is read-only by default and accepts `--dry-run` explicitly.

The preview copies a standalone config as written. For a shared config, it renders only the settings under `[cinch]` and leaves unrelated tables in their original file. The command stops if an include, exclude, or override pattern treats the two managed paths differently and tells you which setting to review. The report uses the active setup plan to name the expected root tool references and leaves edits to those files to the maintainer.

Ropes reads both config generations during the pilot. A single `rope.toml` uses `.ropes/configs/`, and a single legacy source uses `.outfitter/configs/`. A root with more than one supported config source reports a conflict before any write. An `outfitter.toml` without a `[cinch]` table can sit alongside either standalone config.

Keep the working config, managed files, and root tool references in the pre-migration revision. To recover from a later conversion, restore that revision's old policy and root references and remove the new config. A preview itself needs no recovery.
