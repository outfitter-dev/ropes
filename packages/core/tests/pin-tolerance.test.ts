import { expect, test } from "bun:test";

import type { Adapter } from "../src/adapters/adapter.ts";
import { heldTo } from "../src/adapters/pins.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import {
  EXIT_CODE,
  ResultSchema,
  exitCodeOf,
} from "../src/contracts/result.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { renderHuman } from "../src/render/human.ts";
import { runPlan } from "../src/runner/run.ts";
import { fakeAdapter } from "./fake-adapter.ts";
import { BASE, withRepo } from "./repo-bench.ts";

const TESTED = ">=0.3.4 <0.4.0";

const pinned = (installed: string, strict = false): Adapter =>
  fakeAdapter({
    descriptor: strict ? { versionRange: "0.3.4" } : heldTo("0.3.4", TESTED),
    probe: () => Promise.resolve({ available: true, version: installed }),
  });

const run = (adapter: Adapter) =>
  runPlan(
    resolvePlan({
      config: DEFAULT_CONFIG,
      descriptors: [adapter.descriptor],
      packages: [],
      paths: ["a.md", "b.md"],
      root: "/repo",
      selection: { kind: "workspace" },
    }),
    [adapter],
    { mode: "check", platform: "linux" }
  );

test("with no pin an adapter is held to the range it was tested on", () => {
  expect(heldTo(undefined, TESTED)).toEqual({ versionRange: TESTED });
});

test("a tool newer than its pin and inside the tested range runs, with one notice", async () => {
  const result = await run(pinned("0.3.5"));
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
  expect(result.notices).toEqual([
    `fake-tool 0.3.5 is newer than the pinned 0.3.4. It is inside the tested range ${TESTED}, so it ran. In CI or with --strict this is incomplete.`,
  ]);
  expect(ResultSchema.safeParse(result).success).toBe(true);
  expect(renderHuman(result)).toContain("Note: fake-tool 0.3.5 is newer");
});

test("a strict run holds the tool to the exact pin", async () => {
  const result = await run(pinned("0.3.5", true));
  expect(result.steps[0]?.reason).toBe(
    "fake-tool 0.3.5 does not satisfy 0.3.4"
  );
  expect(result.notices).toBeUndefined();
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a tool older than its pin is incomplete even inside the tested range", async () => {
  const result = await run(
    fakeAdapter({
      descriptor: heldTo("0.3.6", TESTED),
      probe: () => Promise.resolve({ available: true, version: "0.3.5" }),
    })
  );
  expect(result.steps[0]?.reason).toBe(
    "fake-tool 0.3.5 does not satisfy 0.3.6"
  );
  expect(result.notices).toBeUndefined();
});

test("a tool newer than the tested range is incomplete", async () => {
  const result = await run(pinned("0.4.0"));
  expect(result.steps[0]?.reason).toBe(
    "fake-tool 0.4.0 does not satisfy 0.3.4"
  );
  expect(exitCodeOf(result)).toBe(EXIT_CODE.incomplete);
});

test("a tool at its pin runs with no notice", async () => {
  const result = await run(pinned("0.3.4"));
  expect(exitCodeOf(result)).toBe(EXIT_CODE.clean);
  expect(result.notices).toBeUndefined();
});

test("check lets a newer tool through, and check --strict does not", async () => {
  await withRepo(BASE, {}, async ({ root }) => {
    const commands = createCommands({ adapters: () => [pinned("0.3.5")] });
    const request = { cwd: root, json: false, paths: ["a.md"] };
    const loose = await commands.check?.(request);
    const strict = await commands.check?.({ ...request, strict: true });
    const explained = await commands.explain?.({ ...request, strict: true });
    expect(loose?.exitCode).toBe(EXIT_CODE.clean);
    expect(loose?.output).toContain("Note: fake-tool 0.3.5 is newer");
    expect(strict?.exitCode).toBe(EXIT_CODE.incomplete);
    expect(strict?.output).toContain("fake-tool 0.3.5 does not satisfy 0.3.4");
    expect(explained?.output).toContain(
      "unavailable: fake-tool 0.3.5 does not satisfy 0.3.4"
    );
  });
});

test("init --strict holds a newer tool to its pin too", async () => {
  await withRepo(BASE, {}, async ({ root }) => {
    const commands = createCommands({ adapters: () => [pinned("0.3.5")] });
    const request = { cwd: root, json: false, paths: [] };
    const loose = await commands.init?.(request);
    const strict = await commands.init?.({ ...request, strict: true });
    expect(loose?.exitCode).toBe(EXIT_CODE.clean);
    expect(strict?.exitCode).toBe(EXIT_CODE.incomplete);
  });
});
