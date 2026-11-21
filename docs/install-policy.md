# Install policy

State the install facts shared by Bun and Renovate in the Cinch or Ropes config:

```toml
[install]
minimum_release_age = "7 days"
isolated = true
release_age_exempt = ["tsrs@7.1.0-beta.tsrs3"]
```

Fixed ages use whole seconds, minutes, hours or days. Exceptions name packages, exact package versions, or several exact versions joined with `||`. Wildcards and version ranges are rejected. A package-only exception also exempts its future releases, so use an exact version when the exception is for one reviewed release.

`cinch doctor` compares the table with `bunfig.toml`. `cinch doctor --fix` writes a missing file or refreshes a generated file containing only the owned install fields. Authored files keep their text and comments until explicit adoption. A file with test settings, registry scopes or other native choices stays authored even if it retains an old generated header. Only the shared values are compared, and drift requires a manual edit. Ordinary `check` and `fix` report install drift without changing those values.

`cinch preset adopt install` previews moving an install-only `bunfig.toml` into the config and replacing it with a generated file. Add `--yes` to apply. The preview identifies that authored comments will be replaced. Conflicting tables or native settings that the table cannot represent stop adoption before writes. `init` can inherit the same install-only settings into a first config.

The first existing Renovate config is compared in Renovate's [default filename order](https://docs.renovatebot.com/configuration-options/#locations-for-configuration-filenames), including JSONC names and the `package.json` fallback. Lower-priority files have no effect. The root `minimumReleaseAge` must state the same fixed duration. A locally unstated value inherited through `extends` is incomplete because this offline comparison cannot resolve the parent. JSON and JSONC syntax are supported. Conditional package rules, exemptions, custom global filenames and remote policy need their own effective-policy review. Doctor compares authored configs in place, and ordinary `fix` can still format them.

The real Bun fixture uses a local registry. It verifies that a just-published package fails the generated release-age gate, an exact-version exception permits it, and the installed dependency uses Bun's isolated layout. Package and lifecycle-script trust remains in `package.json`.
