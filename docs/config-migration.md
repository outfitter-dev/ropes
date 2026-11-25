# Move legacy config to Ropes

Ropes reads repository policy from `rope.toml` and generates setup files under `.ropes/configs/`. Repository commands exit 2 when they find `cinch.toml`, a `[cinch]` table in `outfitter.toml`, or `.outfitter/configs/`. Run `rope migrate` for a short message with the manual steps. It exits 2 and writes no files. `--json` returns the same guidance in the v6 error envelope.

1. Preserve the working policy and tool pointers in a revision you can recover. Move settings from `cinch.toml` to `rope.toml`. For `outfitter.toml`, move only the `[cinch]` settings and keep unrelated tables in the shared file.
2. Review include, exclude, and override paths that reference the old managed directory. Update root tool references to their locations under `.ropes/configs/`. Preserve settings in tool config files your repository owns.
3. Remove the retired policy source and retire `.outfitter/configs/` from the checkout. Other contents of `.outfitter/` can stay in place.
4. Preview regeneration with `rope doctor --fix --dry-run`. Review the diff, run `rope doctor --fix`, then verify with `rope check`.

For a converted repository, the policy, managed files, and root tool references belong in the same reviewed change.
