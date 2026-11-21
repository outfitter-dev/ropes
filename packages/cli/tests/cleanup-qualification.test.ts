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
    "skipped: ast-grep is not on PATH, so cleanup qualification proofs did not run"
  );
}

test.skipIf(missingEngine)(
  "cleanup graduates at full zero and missing required tools stay incomplete",
  async () => {
    await withFixture(async ({ main, emptyPath }) => {
      const policy = await accepted(main.root);
      await Promise.all(["a", "b", "c"].map((name) => fixed(main.root, name)));
      const candidate = await commit(main.root);
      const arguments_ = [
        "check",
        ...args(policy.approved, policy.approved, candidate),
      ];
      const complete = await runEntry(ROPE, arguments_, main.root);
      expect(complete.exitCode).toBe(0);
      expect(json(complete)).toMatchObject({
        outcome: "clean",
        removed: [{}, {}, {}],
        zero: true,
      });
      const git = Bun.which("git");
      if (git === null) {
        throw new Error("Git is required for the fixture");
      }
      await symlink(git, path.join(emptyPath, "git"));
      const missing = await runEntry(ROPE, arguments_, main.root, emptyPath);
      expect(missing.exitCode).toBe(2);
      expect(json(missing)).toMatchObject({
        outcome: "incomplete",
        zero: null,
      });
      expect(missing.stdout).toContain("incomplete required checks");
      const unknown = { ...policy.policy, ruleSha256: "0".repeat(64) };
      await Bun.write(
        path.join(main.root, "unknown.json"),
        JSON.stringify(unknown)
      );
      const approval = await commit(main.root);
      const next = await commit(main.root);
      const mismatch = await compareMigration({
        candidate: next,
        cwd: main.root,
        parent: approval,
        policy: `${approval}:unknown.json`,
      });
      expect(mismatch).toMatchObject({ ok: false });
      if (!mismatch.ok) {
        expect(mismatch.error).toContain("rule digest");
      }
    });
  },
  30_000
);

test.skipIf(missingEngine)(
  "cleanup keeps other required findings blocking",
  async () => {
    await withFixture(async ({ main }) => {
      await Bun.write(path.join(main.root, "bad.toml"), "broken = [\n");
      const config = CONFIG.replace(
        'include = ["**/tsconfig.json"]',
        'include = ["**/tsconfig.json", "bad.toml"]'
      ).replace("[toml]\nenabled = false", "[toml]\nenabled = true");
      const policy = await accepted(main.root, undefined, config);
      await Promise.all(["a", "b", "c"].map((name) => fixed(main.root, name)));
      const candidate = await commit(main.root);
      const result = await compareMigration({
        candidate,
        cwd: main.root,
        parent: policy.approved,
        policy: `${policy.approved}:migration.json`,
      });
      expect(result).toMatchObject({
        ok: true,
        value: { outcome: "findings", zero: true },
      });
    });
  },
  30_000
);

test.skipIf(missingEngine)(
  "cleanup rejects stale parents and policy changes and respects the strict deadline",
  async () => {
    await withFixture(async ({ main }) => {
      const policy = await accepted(main.root, "2099-02-01");
      await fixed(main.root, "a");
      const candidate = await commit(main.root);
      const request = {
        candidate,
        cwd: main.root,
        parent: policy.approved,
        policy: `${policy.approved}:migration.json`,
      };
      const early = await compareMigration({
        ...request,
        at: "2099-01-31T23:59:59.999Z",
      });
      expect(early).toMatchObject({
        ok: true,
        value: { evidence: "simulated", outcome: "clean", zero: false },
      });
      const cutoff = await compareMigration({
        ...request,
        at: "2099-02-01T00:00:00Z",
      });
      expect(cutoff).toMatchObject({
        ok: true,
        value: { outcome: "findings", zero: false },
      });
      expect(
        await compareMigration({ ...request, parent: policy.anchor })
      ).toMatchObject({ ok: false });
      await Bun.write(path.join(main.root, "cinch.toml"), "pilot = 0\n");
      const changed = await commit(main.root);
      const invalid = await compareMigration({
        ...request,
        candidate: changed,
        parent: candidate,
      });
      expect(invalid).toMatchObject({ ok: false });
      if (!invalid.ok) {
        expect(invalid.error).toContain("changing coverage");
      }
      const partial = await runEntry(
        ROPE,
        [
          "check",
          "a/tsconfig.json",
          ...args(policy.approved, candidate, changed),
        ],
        main.root
      );
      expect(partial.exitCode).toBe(2);
    });
  },
  30_000
);
