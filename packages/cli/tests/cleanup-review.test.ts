import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import path from "node:path";

import { compareMigration } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { accepted, args, commit, CONFIG, fixed } from "./cleanup-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const missingEngine = Bun.which("ast-grep") === null;
if (missingEngine) {
  console.warn(
    "skipped: ast-grep is not on PATH, so cleanup review proofs did not run"
  );
}

test.skipIf(missingEngine)(
  "nested cleanup invocations keep the full repository tree and sibling findings",
  async () => {
    await withFixture(async ({ main }) => {
      await Bun.write(path.join(main.root, "a/rope.toml"), CONFIG);
      await Bun.write(
        path.join(main.root, "a/mise.toml"),
        '[tools]\n"ast-grep" = "0.51.3"\n'
      );
      const policy = await accepted(main.root);
      await fixed(main.root, "a");
      await Bun.write(path.join(main.root, "new/tsconfig.json"), "{}\n");
      const candidate = await commit(main.root);
      const arguments_ = [
        "check",
        ...args(policy.approved, policy.approved, candidate),
      ];
      const [root, nested] = await Promise.all([
        runEntry(ROPE, arguments_, main.root),
        runEntry(ROPE, arguments_, path.join(main.root, "a")),
      ]);
      expect(root.exitCode).toBe(1);
      expect(nested.exitCode).toBe(root.exitCode);
      expect(json(nested)).toMatchObject({
        introduced: [{ path: "new/tsconfig.json" }],
        zero: false,
      });
    });
  },
  30_000
);

test.skipIf(missingEngine)(
  "a reviewed policy replacement applies to earlier snapshots and rejects later edits",
  async () => {
    await withFixture(async ({ main }) => {
      const policy = await accepted(main.root);
      await fixed(main.root, "a");
      await commit(main.root);
      await Bun.write(
        path.join(main.root, "migration.json"),
        JSON.stringify({ ...policy.policy, deadline: "2099-02-01" })
      );
      const reviewed = await commit(main.root);
      const candidate = await commit(main.root);
      const request = {
        at: "2099-01-01T00:00:00Z",
        candidate,
        cwd: main.root,
        parent: reviewed,
        policy: `${reviewed}:migration.json`,
      };
      expect(await compareMigration(request)).toMatchObject({
        ok: true,
        value: { outcome: "clean", zero: false },
      });
      await Bun.write(
        path.join(main.root, "migration.json"),
        JSON.stringify({ ...policy.policy, scope: ["a/**"] })
      );
      const changed = await commit(main.root);
      const result = await compareMigration({
        ...request,
        candidate: changed,
        parent: candidate,
      });
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) {
        expect(result.error).toContain("after approval rewrites");
      }
    });
  },
  30_000
);

test.skipIf(missingEngine)(
  "human cleanup output shows planned checks and unrelated blocking diagnostics",
  async () => {
    await withFixture(async ({ main, emptyPath }) => {
      await Bun.write(path.join(main.root, "bad.toml"), "broken = [\n");
      const config = CONFIG.replace(
        'include = ["**/tsconfig.json"]',
        'include = ["**/tsconfig.json", "bad.toml"]'
      ).replace("[toml]\nenabled = false", "[toml]\nenabled = true");
      const policy = await accepted(main.root, undefined, config);
      await Promise.all(["a", "b", "c"].map((name) => fixed(main.root, name)));
      const candidate = await commit(main.root);
      const options = args(policy.approved, policy.approved, candidate).filter(
        (argument) => argument !== "--json"
      );
      const planned = await runEntry(ROPE, ["explain", ...options], main.root);
      expect(planned.stdout).toContain("toml.enabled = true");
      expect(planned.stdout).toContain("bad.toml");
      expect(planned.stdout).toContain("steps");
      const checked = await runEntry(ROPE, ["check", ...options], main.root);
      expect(checked.exitCode).toBe(1);
      expect(checked.stdout).toContain("Candidate raw check diagnostics");
      expect(checked.stdout).toContain("bad.toml");
      expect(checked.stdout).toContain("error");
      expect(checked.stdout).toContain("Full scope zero true");
      const git = Bun.which("git");
      if (git === null) {
        throw new Error("Git is required for this proof");
      }
      await symlink(git, path.join(emptyPath, "git"));
      const incomplete = await runEntry(
        ROPE,
        ["check", ...options],
        main.root,
        emptyPath
      );
      expect(incomplete.exitCode).toBe(2);
      expect(incomplete.stdout).toContain("incomplete");
      expect(incomplete.stdout).toContain("not on PATH");
      expect(incomplete.stdout).toContain("anchor:");
    });
  },
  30_000
);

test.skipIf(missingEngine)(
  "the alternate rule project config is frozen in migration context",
  async () => {
    await withFixture(async ({ main }) => {
      await Bun.write(path.join(main.root, "sgconfig.yaml"), "ruleDirs: []\n");
      const policy = await accepted(main.root);
      await Bun.write(
        path.join(main.root, "sgconfig.yaml"),
        "ruleDirs: []\n# changed after approval\n"
      );
      const candidate = await commit(main.root);
      const result = await compareMigration({
        candidate,
        cwd: main.root,
        parent: policy.approved,
        policy: `${policy.approved}:migration.json`,
      });
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) {
        expect(result.error).toContain("changing coverage");
      }
    });
  },
  30_000
);
