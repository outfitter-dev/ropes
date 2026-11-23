import { STANDALONE } from "@ropes/core";

import manifest from "../package.json" with { type: "json" };

const setup = STANDALONE
  ? `Setup requires a Git checkout with an initial commit, or Git-colocated jj.
Pin this executable's immutable version and checksum through mise. Install
and pin the external engines required by your repository's Ropes config.`
  : `Setup requires a Git checkout with an initial commit, or Git-colocated jj.
Git HEAD and the index must be readable. Track the pin and lockfile:
  bun add --dev --exact @ropes/cli@${manifest.version}
  git add package.json bun.lock
  git commit -m "chore: pin Ropes"
  ./node_modules/.bin/rope --help
  ./node_modules/.bin/rope init
  ./node_modules/.bin/rope init --yes
  ./node_modules/.bin/rope check README.md`;

export const HELP = `rope ${manifest.version}

Usage: rope <explain|check|fix> [path...] [--json] [--strict]
       rope <explain|check> [path...] --at <UTC instant>
       rope doctor [--fix [--dry-run]] [--json] [--strict]
       rope rules [list|adopt [pack...]] [--yes] [--dry-run] [--json]
       rope init [--yes] [--dry-run] [--json] [--strict]
       rope fix [path...] --dry-run
       rope explain [path...] [--rule <id>] [--trace] [--json]
       rope preset [list|update] [name] [--dry-run] [--json]
       rope preset <add|adopt|eject> <name> [--yes] [--dry-run] [--json]
       rope schema [command] [--json]
       rope migrate [--dry-run] [--json]
       rope <explain|check> --migration <commit>:<file> --parent <commit> --candidate <commit>
       rope policy snapshot [path...] [--at <UTC instant>]
       rope policy compare <before.json> <after.json> [--json]

  explain   Show which checks apply and where the policy comes from
  check     Check the selected files without writing to the repository
  doctor    Inspect setup and active tools, or repair setup with --fix
  init      Preview or apply setup for this repository
  fix       Fix the selected files or preview changes with --dry-run
  preset    Inspect or manage the repository presets
  schema    Print a JSON Schema or list the available names
  migrate   Preview a legacy Cinch config migration
  rules     List rule packs or preview and apply adoption
  policy    Capture and compare resolved rule policy

${setup}

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

export const version = (entry: string) =>
  STANDALONE
    ? `rope ${manifest.version} (binary)`
    : `rope ${manifest.version}\n${entry}`;
