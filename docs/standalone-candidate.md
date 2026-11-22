# Prepare a standalone release

The `Standalone candidate` workflow prepares the three native Ropes archives from one commit on `main`. It runs the compiled `rope` acceptance suite against the executable retained in each archive, then verifies that extraction preserves those bytes and executable permissions.

## Prepare the candidate

```sh
gh workflow run standalone-candidate.yml --repo outfitter-dev/ropes --ref main
gh run list --repo outfitter-dev/ropes --workflow standalone-candidate.yml
```

Wait for all three jobs to pass. Record the run URL and its full source commit. Download its three artifacts with the selected run ID:

```sh
gh run download RUN_ID --repo outfitter-dev/ropes --pattern 'ropes-standalone-*' --dir candidate
```

Each artifact contains a versioned archive, `SHA256SUMS`, and `candidate.json`. The JSON identifies the source commit, package version, platform, archive name, and SHA-256. Verify the downloaded bytes from each artifact directory:

```sh
shasum -a 256 -c SHA256SUMS
```

| Platform    | Runner             | Archive                             |
| ----------- | ------------------ | ----------------------------------- |
| macOS arm64 | `macos-15`         | `ropes-VERSION-darwin-arm64.tar.gz` |
| Linux x64   | `ubuntu-24.04`     | `ropes-VERSION-linux-x64.tar.gz`    |
| Linux arm64 | `ubuntu-24.04-arm` | `ropes-VERSION-linux-arm64.tar.gz`  |

The archives contain `rope` and the MIT license. The version must agree across `@ropes/core`, `@ropes/cli`, and the compiled executable. The CLI uses the local workspace core or the matching exact core version. The workflow runs each target on its native architecture. Intel macOS requires its own qualification before an archive is offered.

## Verify a clean install

In a disposable consumer checkout, configure mise to install the downloaded archive by its exact version and digest. Use a fresh mise cache and give the check Git and the consumer's pinned engines on `PATH`.

```toml
[tools."http:rope"]
version = "VERSION"
url = "file:///absolute/path/to/ropes-VERSION-darwin-arm64.tar.gz"
bin = "rope"
checksum = "sha256:ARCHIVE_SHA256"
```

Run `mise install`, then `mise exec -- rope --version` and `mise exec -- rope check README.md --json`, with Bun absent from `PATH`. Compare the installed executable with the one in the archive. Compare the check's exit code and JSON with the package CLI on the same checkout, and verify that the checkout and Git index stayed clean.

## Approve the exact release

Bring the source commit, successful run, three archive digests, and installation results to the release owner. The workflow has read-only repository access and retains candidates as Actions artifacts. The first public binary release requires maintainer approval for the exact archives.

The proposed public location is a versioned GitHub release in `outfitter-dev/ropes`, with a tag such as `vVERSION` that resolves to the candidate's source commit. An approved upload preserves the downloaded candidate bytes. Its URLs have this shape:

```text
https://github.com/outfitter-dev/ropes/releases/download/vVERSION/ropes-VERSION-darwin-arm64.tar.gz
https://github.com/outfitter-dev/ropes/releases/download/vVERSION/ropes-VERSION-linux-x64.tar.gz
https://github.com/outfitter-dev/ropes/releases/download/vVERSION/ropes-VERSION-linux-arm64.tar.gz
```

After upload, download the public archives without credentials and compare their SHA-256 values with the approved record. Use a new version identity for changed bytes. Preserve the source and digest record with the release. The [standalone installation guide](binary.md) covers mise and its same-version cache behavior.

The Homebrew formula consumes those public archive URLs and digests. Its [publication issue](https://linear.app/outfitter/issue/ROPE-85) also requires the tap's tested formula head, bottle evidence, and clean install results.
