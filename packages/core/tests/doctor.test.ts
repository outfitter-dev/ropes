import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { StepOutcome } from "../src/adapters/adapter.ts";
import type { FileInput } from "../src/adapters/batch.ts";
import { managedAdapter } from "../src/adapters/managed.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";
import { parsePlan } from "../src/contracts/parse.ts";
import { FIXED, PASSED, fakeAdapter } from "./fake-adapter.ts";

const KEPT = ".ropes/configs/notes.toml";
const SHIPPED = "width = 80\n";

const kept = managedAdapter({
  enabledBy: "markdown.preset",
  files: [
    { path: KEPT, want: () => Promise.resolve({ ok: true, text: SHIPPED }) },
  ],
  id: "notes-preset",
  preset: "notes",
});

/** A fixer for the repository's own files: TODO becomes DONE. */
const rewrite = async (input: FileInput): Promise<StepOutcome> => {
  const file = Bun.file(path.join(input.root, input.path));
  const before = await file.text();
  await Bun.write(file, before.replaceAll("TODO", "DONE"));
  return before.includes("TODO") ? FIXED : PASSED;
};

const engine = (probe?: () => Promise<{ available: false; reason: string }>) =>
  fakeAdapter({ fix: rewrite, ...(probe === undefined ? {} : { probe }) });

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "ropes-doctor-")));
  await mkdir(path.join(root, ".git"));
  await Bun.write(path.join(root, "rope.toml"), "pilot = 0\n");
  await Bun.write(path.join(root, "a.md"), "TODO\n");
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const run = (
  verb: string,
  request: Partial<CommandRequest> = {},
  adapters = [kept, engine()]
) => {
  const command = createCommands({ adapters: () => adapters })[verb];
  if (!command) {
    throw new Error(`no command ${verb}`);
  }
  return command({ cwd: root, json: true, paths: [], ...request });
};

const exit = async (...asked: Parameters<typeof run>): Promise<number> => {
  const response = await run(...asked);
  return response.exitCode;
};

const text = (file: string): Promise<string> =>
  Bun.file(path.join(root, file)).text();
const exists = (file: string): Promise<boolean> =>
  Bun.file(path.join(root, file)).exists();

test("fix writes nothing while the setup is broken, and says who repairs it", async () => {
  for (const paths of [[], ["a.md"]]) {
    // oxlint-disable-next-line no-await-in-loop
    const response = await run("fix", { paths });
    const report = FixReportSchema.parse(JSON.parse(response.output ?? ""));
    expect(response.exitCode).toBe(1);
    expect(report.changed).toEqual([]);
    expect(report.stopped).toContain("rope doctor --fix");
    expect(report.result.steps.map((step) => step.path)).toEqual([KEPT]);
  }
  expect(await text("a.md")).toBe("TODO\n");
  expect(await exists(KEPT)).toBe(false);
  const plain = await run("fix", { json: false });
  expect(plain.output).toStartWith("Nothing was fixed");
});

test("doctor reports the setup and writes nothing without --fix", async () => {
  const response = await run("doctor");
  const report = DoctorReportSchema.parse(JSON.parse(response.output ?? ""));
  expect(response.exitCode).toBe(1);
  expect(report.fix).toBe(false);
  expect(report.changed).toEqual([]);
  expect(report.result.steps).toMatchObject([
    { adapter: "notes-preset", path: KEPT, status: "findings" },
  ]);
  expect(report.tools).toEqual([{ tool: "fake-tool", versionRange: "*" }]);
  expect(await exists(KEPT)).toBe(false);
  const plain = await run("doctor", { json: false });
  expect(plain.output).toContain("Run `rope doctor --fix`. Exit code 1.");
});

test("doctor --fix writes the setup and nothing of the repository's own", async () => {
  const preview = await run("doctor", { dryRun: true, fix: true });
  const previewed = DoctorReportSchema.parse(JSON.parse(preview.output ?? ""));
  expect(previewed).toMatchObject({ changed: [KEPT], dryRun: true });
  expect(await exists(KEPT)).toBe(false);

  const response = await run("doctor", { fix: true });
  const report = DoctorReportSchema.parse(JSON.parse(response.output ?? ""));
  expect(response.exitCode).toBe(0);
  expect(report).toMatchObject({ changed: [KEPT], dryRun: false, fix: true });
  expect(await text(KEPT)).toBe(SHIPPED);
  expect(await text("a.md")).toBe("TODO\n");

  expect(await exit("doctor")).toBe(0);
  const fixed = await run("fix");
  expect(fixed.exitCode).toBe(0);
  expect(await text("a.md")).toBe("DONE\n");
});

test("fix never rewrites a kept file, even one it is asked for by name", async () => {
  await run("doctor", { fix: true });
  await Bun.write(path.join(root, KEPT), "width = 100\n");
  const response = await run("fix", { paths: [KEPT] });
  expect(response.exitCode).toBe(1);
  expect(await text(KEPT)).toBe("width = 100\n");
  expect(await exit("check")).toBe(1);
});

test("explain marks a setup step, and says which verb writes it", async () => {
  const shown = await run("explain");
  const parsed = parsePlan(JSON.parse(shown.output ?? ""));
  const steps = parsed.ok
    ? parsed.value.paths.flatMap((entry) => entry.steps)
    : [];
  expect(steps.map((step) => [step.adapter, step.setup])).toEqual([
    ["notes-preset", true],
    ["fake", undefined],
  ]);
  const plain = await run("explain", { json: false });
  expect(plain.output).toContain("checks, and `doctor --fix` writes");
});

test("a tool that cannot run leaves doctor incomplete", async () => {
  await run("doctor", { fix: true });
  const missing = engine(() =>
    Promise.resolve({ available: false, reason: "fake-tool is not on PATH" })
  );
  const response = await run("doctor", { json: false }, [kept, missing]);
  expect(response.exitCode).toBe(2);
  expect(response.output).toContain("unavailable: fake-tool is not on PATH");
  expect(response.output).toContain("Exit code 2.");
});

test("doctor refuses paths, and a kept file the config leaves out", async () => {
  expect(await run("doctor", { paths: ["a.md"] })).toMatchObject({
    error: "rope: doctor checks the whole setup, so it takes no paths.",
    exitCode: 2,
  });
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\nexclude = [".ropes/**"]\n'
  );
  const response = await run("doctor", { fix: true });
  expect(response.exitCode).toBe(2);
  expect(response.error).toContain(`leaves ${KEPT} out`);
  expect(await exists(KEPT)).toBe(false);
});

test("a preset that is switched off is no part of the setup", async () => {
  await Bun.write(
    path.join(root, "rope.toml"),
    "pilot = 0\n\n[markdown]\npreset = false\n"
  );
  expect(await exit("doctor")).toBe(0);
  expect(await exit("fix")).toBe(0);
  expect(await exists(KEPT)).toBe(false);
  // Leaving the file out as well changes nothing: there is nothing to keep.
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\nexclude = [".ropes/**"]\n\n[markdown]\npreset = false\n'
  );
  expect(await exit("doctor")).toBe(0);
  expect(await exit("doctor", { fix: true })).toBe(0);
  expect(await exit("fix")).toBe(0);
});

test("fix stops when the config leaves a kept file out", async () => {
  await Bun.write(path.join(root, KEPT), "width = 60\n");
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\nexclude = [".ropes/**"]\n'
  );
  const response = await run("fix");
  expect(response.exitCode).toBe(2);
  expect(response.error).toContain(`leaves ${KEPT} out`);
  expect(await Bun.file(path.join(root, "a.md")).text()).toBe("TODO\n");
});
