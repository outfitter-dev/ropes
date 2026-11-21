# Check and update GitHub workflows

`bun run check` starts with the workflow gate. Run it alone with `bun run check:workflows` after activating the pinned tools with mise.

The gate runs actionlint, zizmor and pinact over `.github/workflows`. Actionlint checks workflow syntax and expressions. Its optional ShellCheck and Pyflakes integrations are disabled so host-installed tools cannot change this gate. Zizmor uses its regular audit profile with strict input collection and offline mode. Pinact checks that external actions use full commit SHAs and version comments. A finding or tool failure stops the gate with a nonzero exit. These local checks require no GitHub credentials or network access.

Tool versions and platform checksums live in `mise.toml` and `mise.lock`. CI installs them through the pinned mise action before running the same `bun run check` command.

## Update action pins

Pinact owns the Ropes workflow SHA pins. Run the pinned writer when adopting or updating an action:

```sh
mise exec -- bun run update:actions
mise exec -- pinact run --fix=false --verify-comment
mise exec -- bun run check:workflows
```

The update command resolves current upstream releases and writes the SHA with its version comment. The second command verifies comments against upstream tags. Those two operations use GitHub's API. Pinact accepts `PINACT_GITHUB_TOKEN` or `GITHUB_TOKEN` for authenticated requests. Review the generated workflow diff and the release notes, then submit it through the normal pull request process.

The offline gate verifies SHA syntax and the required version comment. Upstream tag verification happens during the deliberate update and review step. Keep one writer for action pins if Renovate is added later.

The initial pinact run updated checkout to v7.0.1 and retained mise-action v5.2.10. The [real-tool regression](../tests/workflows.test.ts) proves malformed workflows, a dangerous workflow trigger and an unpinned action each fail while leaving the fixture bytes untouched.

[Actionlint usage](https://github.com/rhysd/actionlint/blob/main/docs/usage.md) · [Zizmor usage](https://github.com/zizmorcore/zizmor/blob/main/docs/usage.md) · [Pinact checks](https://github.com/suzuki-shunsuke/pinact/blob/main/docs/check.md) · [Pinact updates](https://github.com/suzuki-shunsuke/pinact/blob/main/docs/update.md)
