import { expect } from "bun:test";
import path from "node:path";

import { explain, parseCleanup } from "@ropes/core";

import { gitText } from "../../cinch/src/commands/cleanup/git.ts";
import {
  fixtureGit,
  json,
  runEntry,
} from "../../cinch/tests/acceptance-repo.ts";
import { CONFIG, RULE } from "./cleanup-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
export const BEFORE = "2099-01-31T23:59:59.999Z";
export const DEADLINE = "2099-02-01T00:00:00.000Z";
export const names = Array.from(
  { length: 12 },
  (_, index) => `p${String(index + 1).padStart(2, "0")}`
);

export const head = async (root: string): Promise<string> => {
  const revision = await gitText(root, "rev-parse", "HEAD");
  return revision.trim();
};

export const save = async (root: string, message: string): Promise<string> => {
  await fixtureGit(root, "add", "--all");
  await fixtureGit(
    root,
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    message
  );
  return await head(root);
};

export const repair = (root: string, selected: readonly string[]) =>
  Promise.all(
    selected.map((name) =>
      Bun.write(
        path.join(root, "packages", name, "tsconfig.json"),
        '{"extends":"../../shared.json"}\n'
      )
    )
  );

export const campaign = async (root: string) => {
  await Bun.write(path.join(root, "rope.toml"), CONFIG);
  await Bun.write(
    path.join(root, "mise.toml"),
    '[tools]\n"ast-grep" = "0.51.3"\n'
  );
  await Promise.all(
    names.map((name) =>
      Bun.write(path.join(root, "packages", name, "tsconfig.json"), "{}\n")
    )
  );
  const anchor = await save(root, "accepted twelve compiler configs");
  const explained = await explain({ cwd: root, paths: [] });
  if (!explained.ok) {
    throw new Error(explained.error);
  }
  const digest = explained.value.plan.rules
    ?.flatMap(({ rules }) => rules)
    .find(({ id }) => id === RULE)?.digest;
  if (digest === undefined) {
    throw new Error(
      "The public plan must expose the exact migration rule digest."
    );
  }
  await Bun.write(
    path.join(root, "migration.json"),
    JSON.stringify({
      anchor,
      deadline: "2099-02-01",
      rule: RULE,
      ruleSha256: digest,
      schemaVersion: 1,
      scope: ["packages/**/tsconfig.json"],
    })
  );
  const approved = await save(root, "approve fixed migration scope and anchor");
  await repair(root, names.slice(0, 5));
  const first = await save(root, "layer one removes five occurrences");
  await repair(root, names.slice(5, 9));
  const second = await save(root, "layer two removes four occurrences");
  await repair(root, names.slice(9));
  const third = await save(root, "layer three removes three occurrences");
  return { anchor, approved, first, second, third };
};

export const migration = async (
  root: string,
  approved: string,
  parent: string,
  candidate: string,
  expected = 0,
  at = BEFORE
) => {
  const ran = await runEntry(
    ROPE,
    [
      "check",
      "--migration",
      `${approved}:migration.json`,
      "--parent",
      parent,
      "--candidate",
      candidate,
      "--at",
      at,
      "--json",
    ],
    root
  );
  expect(ran.exitCode).toBe(expected);
  if (ran.stdout === "") {
    throw new Error(ran.stderr);
  }
  const parsed = parseCleanup(json(ran));
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.error));
  }
  return parsed.value;
};

export const migrationInput = (
  approved: string,
  parent: string,
  candidate: string
) => [
  "check",
  "--migration",
  `${approved}:migration.json`,
  "--parent",
  parent,
  "--candidate",
  candidate,
  "--at",
  BEFORE,
  "--json",
];

export const command = (root: string, args: readonly string[]) =>
  runEntry(ROPE, args, root);
