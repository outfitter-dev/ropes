import path from "node:path";

import { adaptersFor } from "../../cinch/src/adapters/registry.ts";
import { gitText } from "../../cinch/src/commands/cleanup/git.ts";
import { fixtureGit } from "../../cinch/tests/acceptance-repo.ts";

export const RULE = "config/tsconfig-extends";
export const CONFIG = `pilot = 0
include = ["**/tsconfig.json"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
packs = ["config"]
`;

export const commit = async (root: string): Promise<string> => {
  await fixtureGit(root, "add", "--all");
  await fixtureGit(
    root,
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    "cleanup fixture"
  );
  const head = await gitText(root, "rev-parse", "HEAD");
  return head.trim();
};

export const accepted = async (
  root: string,
  deadline?: string,
  config = CONFIG
) => {
  await Bun.write(path.join(root, "rope.toml"), config);
  await Bun.write(
    path.join(root, "mise.toml"),
    '[tools]\n"ast-grep" = "0.51.3"\n'
  );
  await Promise.all(
    ["a", "b", "c"].map((name) =>
      Bun.write(path.join(root, name, "tsconfig.json"), "{}\n")
    )
  );
  const anchor = await commit(root);
  const digest = adaptersFor({}).find(
    ({ descriptor }) => descriptor.ruleDigests?.[RULE] !== undefined
  )?.descriptor.ruleDigests?.[RULE];
  const policy = {
    anchor,
    ...(deadline === undefined ? {} : { deadline }),
    rule: RULE,
    ruleSha256: digest,
    schemaVersion: 1,
    scope: ["**/tsconfig.json"],
  };
  await Bun.write(path.join(root, "migration.json"), JSON.stringify(policy));
  const approved = await commit(root);
  return { anchor, approved, file: "migration.json", policy };
};

export const fixed = (root: string, name: string) =>
  Bun.write(
    path.join(root, name, "tsconfig.json"),
    '{"extends":"../shared.json"}\n'
  );

export const args = (approved: string, parent: string, candidate: string) => [
  "--migration",
  `${approved}:migration.json`,
  "--parent",
  parent,
  "--candidate",
  candidate,
  "--json",
];
