import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { EditorSettings } from "../../contracts/editor.ts";
import type { FileOutcome, StepInput } from "../adapter.ts";
import { eachFile } from "../batch.ts";
import { exec } from "../exec.ts";
import { readOutput } from "./check-output.ts";
import { render } from "./render.ts";

/** Read-only native validation against the shared settings, in an isolated root. */
export const run = (
  binary: string,
  input: StepInput,
  settings: EditorSettings
): Promise<FileOutcome[]> =>
  eachFile(input, async ({ root, path: file }) => {
    const base = await mkdtemp(path.join(tmpdir(), "ropes-editor-"));
    try {
      if (path.posix.basename(file) === ".editorconfig") {
        throw new Error(
          "an EditorConfig file cannot be checked as its own policy"
        );
      }
      const copy = path.join(base, "root");
      const target = path.join(copy, file);
      await mkdir(path.dirname(target), { recursive: true });
      await Promise.all([
        Bun.write(target, await readFile(path.join(root, file))),
        Bun.write(path.join(copy, ".editorconfig"), render(settings)),
        Bun.write(path.join(base, "checker.json"), "{}"),
      ]);
      const argv = [
        binary,
        "--config",
        path.join(base, "checker.json"),
        "--ignore-defaults",
        "--no-color",
      ];
      const coverage = await exec([...argv, "--dry-run", "--", file], copy);
      if (
        coverage.exitCode !== 0 ||
        coverage.stderr !== "" ||
        coverage.stdout !== `${file}\n`
      ) {
        throw new Error("the editor checker did not select the required file");
      }
      const checked = await exec(
        [...argv, "--format", "codeclimate", "--", file],
        copy
      );
      if (checked.stderr !== "" || ![0, 1].includes(checked.exitCode)) {
        throw new Error("the editor checker could not complete the file");
      }
      const findings = readOutput(checked.stdout, file);
      if ((checked.exitCode === 0) !== (findings.length === 0)) {
        throw new Error("the editor checker verdict contradicted its findings");
      }
      return {
        findings,
        status: findings.length === 0 ? "passed" : "findings",
      };
    } catch (error) {
      return {
        findings: [],
        reason: error instanceof Error ? error.message : String(error),
        status: "incomplete",
      };
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
