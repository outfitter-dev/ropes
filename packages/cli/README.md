# Ropes CLI

`@ropes/cli` installs the `rope` command. Use Bun 1.4.4 or newer and put the engines required by your repository's policy on `PATH`. Run these commands in a Git checkout with an initial commit.

```sh
bun add --dev --exact @ropes/cli@0.1.0-canary.4
./node_modules/.bin/rope --version
```

`rope explain` shows which files and checks the configuration selects. Run `rope check` to report findings and `rope fix --dry-run` to preview repairs.

See the included LICENSE for the MIT terms.
