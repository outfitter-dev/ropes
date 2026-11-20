import { expect, test } from "bun:test";
import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { check, readRepairs } from "@ropes/core";

import { fixtureGit, withFixture } from "../../cinch/tests/acceptance-repo.ts";
import { FILES, RATIONALE } from "./trace-fixture.ts";

const HOOK = new URL("repair-hook.ts", import.meta.url);
const READER = new URL("repair-reader.ts", import.meta.url);

test("a fresh offline reader recovers the failed attempt and verified repair", async () => {
  if (Bun.which("ast-grep") === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so the offline repair proof did not run"
    );
    return;
  }
  const history = await realpath(
    await mkdtemp(path.join(tmpdir(), "ropes-repairs-"))
  );
  const records = path.join(history, "records");
  const baseline = path.join(history, "original.json");
  try {
    await withFixture(async ({ main }) => {
      await Promise.all(
        Object.entries(FILES).map(([file, text]) =>
          Bun.write(path.join(main.root, file), text)
        )
      );
      const config = `${FILES["cinch.toml"] ?? ""}\n[overrides.typescript]\nenabled = false\n[typescript]\nenabled = true\npreset = false\n`;
      await Bun.write(path.join(main.root, "cinch.toml"), config);
      await Bun.write(
        path.join(main.root, "src/private/types.ts"),
        "export interface PrivateType { value: string }\n"
      );
      await Bun.write(path.join(main.root, "src/index.ts"), "export {};\n");
      await Bun.write(
        path.join(main.root, "tsconfig.json"),
        '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}\n'
      );
      await fixtureGit(main.root, "add", "--all");
      await fixtureGit(
        main.root,
        "commit",
        "--quiet",
        "--message",
        "repair baseline"
      );
      const original = await check({ cwd: main.root, paths: [] });
      if (!original.ok) {
        throw new Error(original.error);
      }
      expect(
        original.value.steps.flatMap((step) =>
          step.findings.map(({ rule }) => rule)
        )
      ).toContain("local/private-import");
      await Bun.write(baseline, JSON.stringify(original.value));
      const hook = async (id: string, directory = records) => {
        const child = Bun.spawn([process.execPath, HOOK.pathname], {
          cwd: main.root,
          env: {
            ...process.env,
            ROPES_REPAIR_BASELINE: baseline,
            ROPES_REPAIR_DIR: directory,
          },
          stderr: "pipe",
          stdin: "pipe",
          stdout: "pipe",
        });
        await child.stdin.write(
          JSON.stringify({
            cwd: main.root,
            hook_event_name: "PostToolUse",
            session_id: "offline-pilot",
            tool_input: { file_path: path.join(main.root, "src/a file.ts") },
            tool_name: "Edit",
            tool_response: { success: true },
            tool_use_id: id,
          })
        );
        await child.stdin.end();
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stderr, stdout };
      };
      await Bun.write(
        path.join(main.root, "src/a file.ts"),
        'import { PrivateType } from "./index";\n'
      );
      const failed = await hook("first");
      expect(failed.exitCode).toBe(1);
      expect(failed.stderr).toBe("");
      const duplicate = await hook("first");
      expect(duplicate.exitCode).toBe(1);
      expect(await readdir(records)).toHaveLength(1);
      const storageFailure = await hook("cannot-save", baseline);
      expect(storageFailure.exitCode).toBe(failed.exitCode);
      expect(storageFailure.stdout).toBe(failed.stdout);
      expect(storageFailure.stderr).toContain("Repair evidence was not saved");
      await Bun.write(
        path.join(main.root, "src/index.ts"),
        'export type { PrivateType } from "./private/types";\n'
      );
      const fixed = await hook("second");
      expect(fixed.exitCode).toBe(0);
      expect(fixed.stderr).toBe("");
      const found = await readRepairs(records);
      if (!found.ok) {
        throw new Error(found.error);
      }
      expect(found.value).toHaveLength(2);
      const [first, second] = found.value;
      expect(
        first?.result.steps
          .flatMap((step) => step.findings.map(({ message }) => message))
          .join("\n")
      ).toContain("export");
      expect(first?.edit.patch).toContain(
        '+import { PrivateType } from "./index";'
      );
      expect(second?.result.outcome).toBe("clean");
      expect(second?.edit.patch).toContain(
        '+export type { PrivateType } from "./private/types";'
      );
      expect(second?.policy).toEqual(first?.policy);
      expect(
        second?.tools.map(({ tool, version }) => ({ tool, version }))
      ).toEqual(first?.tools.map(({ tool, version }) => ({ tool, version })));
      expect(second?.result.plan.selection).toEqual(
        first?.result.plan.selection
      );
      expect(second?.convention.authored.rationale).toBe(RATIONALE);
    });
    const saved = await readRepairs(records);
    if (!saved.ok) {
      throw new Error(saved.error);
    }
    await Promise.all(
      saved.value.map(async (record) => {
        const replay = path.join(history, `replay-${record.id}`);
        await Promise.all(
          Object.entries(record.edit.baseFiles).map(([file, text]) =>
            Bun.write(path.join(replay, file), text)
          )
        );
        await fixtureGit(replay, "init", "--quiet");
        const patch = path.join(history, `${record.id}.patch`);
        await Bun.write(patch, record.edit.patch);
        await fixtureGit(replay, "apply", patch);
        const rerun = await check({ cwd: replay, paths: [] });
        if (!rerun.ok) {
          throw new Error(rerun.error);
        }
        expect(rerun.value.outcome).toBe(record.result.outcome);
        expect(rerun.value.steps.flatMap((step) => step.findings)).toEqual(
          record.result.steps.flatMap((step) => step.findings)
        );
      })
    );
    const child = Bun.spawn([process.execPath, READER.pathname, records], {
      cwd: history,
      env: { ...process.env, PATH: "" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stderr).text()).toBe("");
    expect(output).toContain('"evidence":"observed"');
    expect(output).toContain('"authored":');
    expect(output).toContain('"outcome":"findings"');
    expect(output).toContain('"outcome":"clean"');
    expect(output).toContain('"rule":"TS2305"');
  } finally {
    await rm(history, { force: true, recursive: true });
  }
}, 30_000);
