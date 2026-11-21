# Markdown links

The Markdown profile runs two pinned engines. rumdl checks Markdown style and its native link rules. Lychee 0.24.2 checks local file destinations and heading fragments using its Markdown parser. A selected source can refer to an unselected destination in another package, and the destination's headings are checked from disk. This avoids rumdl's multi-file requirement leaving cross-file fragments unchecked after package batching or path selection. [rumdl MD051](https://raw.githubusercontent.com/rvben/rumdl/v0.3.5/docs/md051.md) · [Lychee anchors](https://lychee.cli.rs/recipes/anchors/)

```sh
mise exec -- rope explain docs/guide.md --trace
mise exec -- rope check docs/guide.md
```

Both engines follow `markdown.enabled`, including ordered path overrides and exclusions. Markdown is enabled by default, so users of the profile need the pinned Lychee executable alongside rumdl. The plan names the Lychee step and required version. Trace output shows the exact extraction and check invocations. A missing engine, an unusable report, an unsupported engine error, or a target that escapes the policy root produces an incomplete result and exit 2.

The checker uses offline mode, file URLs, anchor-fragment checking and a disabled request cache. External URLs are excluded by the engine, and a loopback request counter verifies that checking never requests them. Native user config is isolated for this invocation. An explicit include keeps required local checks active even when `.lycheeignore` excludes them. Suppress the Markdown profile through the Ropes path policy when a document deliberately uses unsupported local routing.

Relative files, reference links, source-relative subdirectories, spaces, percent-encoded paths, Unicode headings and same-root target symlinks use the engine's native parsing and resolution. Existing directory links are checked for directory existence. Targets remain within the resolved policy root, including when a symlink or `..` would reach another directory. Site-specific routing, generated browser anchors and files outside that root need their own validation context.

Findings retain Lychee's source line and column. `local-file` identifies a missing target and `local-fragment` identifies a missing heading. Diagnostics use root-relative target names so previews and ordinary runs agree. rumdl may also report its native link diagnostic for the same authored problem.

`fix` checks the links after the profile's Markdown repairs. A dry-run preview uses native URL extraction to snapshot referenced files that the ordinary copy would omit, including ignored generated targets. Directory targets preserve directory existence. A preview that depends on a target symlink is explicitly incomplete because an independent copy could otherwise break its relationship to a file repaired elsewhere in the preview. Normal checking supports same-root symlinks.

## External URL report

The `External links` workflow runs every Monday at 09:23 UTC and supports manual dispatch on the default branch. It checks HTTP and HTTPS URLs from tracked Markdown with private, loopback and link-local destinations excluded. Tracked filenames are passed as a NUL-delimited Bash array, preserving spaces, Unicode and literal newlines.

The workflow has `contents: read`, saves a seven-day report artifact and appends the checker outcome/report to the job summary. It has schedule/manual triggers and stays outside pull-request qualification. Native failures describe observed HTTP or network responses. Authentication failures and transient third-party outages require interpretation when reviewing the report.
