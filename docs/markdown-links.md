# Markdown links

Markdown style uses rumdl and its native link rules. Repositories can independently opt into pinned Lychee 0.24.2 to check local file destinations and heading fragments using its Markdown parser. A selected source can refer to an unselected destination in another package, and the destination's headings are checked from disk. This avoids rumdl's multi-file requirement leaving cross-file fragments unchecked after package batching or path selection. [rumdl MD051](https://raw.githubusercontent.com/rvben/rumdl/v0.3.5/docs/md051.md) · [Lychee anchors](https://lychee.cli.rs/recipes/anchors/)

```sh
mise exec -- rope explain docs/guide.md --trace
mise exec -- rope check docs/guide.md
```

Local link checking is off until `[markdown] links = true` is stated. This switch is independent of `markdown.enabled`, which controls style checking. Both switches support ordered path overrides and exclusions, and existing consumers keep their Markdown behavior without installing Lychee. To disable both checks for a path, set both switches to false.

```toml
[markdown]
links = true
```

The local-link adapter currently supports macOS and Linux; explicitly requesting it on Windows is incomplete. Windows local-link checking and scratch previews have not been qualified. The repository pin uses official static musl Linux builds to avoid the GNU release binary’s glibc 2.39 requirement. Both x64 and arm64 musl builds were checked against their release SHA-256 and ran a broken-heading fixture on Ubuntu 22.04 (glibc 2.35) with networking disabled. A system CA bundle is still required by the native client even offline. The Ropes repository opts into this qualified scope. The plan names the Lychee step and required version. Trace output shows the exact extraction and check invocations. A missing engine, an unusable report, an unsupported engine error, or a target that escapes the policy root produces an incomplete result and exit 2.

The checker uses offline mode, file URLs, anchor-fragment checking and a disabled request cache. External URLs are excluded by the engine, and a loopback request counter verifies that checking never requests them. Native user config is isolated for this invocation. Source paths are escaped as native literal globs. Warning logging is forced on, and native warnings make the result incomplete, including a fragment check skipped because its target could not be decoded or read. An explicit include keeps required local checks active even when `.lycheeignore` excludes them. Disable `markdown.links` through the Ropes path policy when a document deliberately uses unsupported local routing.

Relative files, reference links, source-relative subdirectories, spaces, percent-encoded paths, Unicode headings and same-root target symlinks use the engine's native parsing and resolution. Existing directory links are checked for directory existence. Targets remain within the resolved policy root, including when a symlink or `..` would reach another directory. Site-specific routing, generated browser anchors and files outside that root need their own validation context.

Findings retain Lychee's source line and column. `local-file` identifies a missing target and `local-fragment` identifies a missing heading. Diagnostics use root-relative target names so previews and ordinary runs agree. rumdl may also report its native link diagnostic for the same authored problem.

`fix` checks the links after the profile's Markdown repairs. A dry-run preview uses native URL extraction to snapshot referenced files that the ordinary copy would omit, including ignored generated targets. Directory targets preserve directory existence. A preview that depends on a target symlink is explicitly incomplete because an independent copy could otherwise break its relationship to a file repaired elsewhere in the preview. Normal checking supports same-root symlinks.

## External URL report

The `External links` workflow runs every Monday at 09:23 UTC and supports manual dispatch on the default branch. It checks HTTP and HTTPS URLs from tracked Markdown with private, loopback and link-local destinations excluded. Tracked filenames are passed as a NUL-delimited Bash array and converted to native glob literals, preserving spaces, Unicode, literal newlines and glob metacharacters.

The workflow has `contents: read`, saves a seven-day report artifact and appends the checker outcome/report to the job summary. It has schedule/manual triggers and stays outside pull-request qualification. Native failures describe observed HTTP or network responses. Authentication failures and transient third-party outages require interpretation when reviewing the report.
