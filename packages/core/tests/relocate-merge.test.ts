import { afterAll, expect, test } from "bun:test";

import {
  POLICY,
  CONFIG,
  EXTENDS,
  ROOT,
  cleanUp,
  move,
  read,
  repo,
} from "./relocate-repo.ts";

afterAll(cleanUp);

test("adopt stops, and writes nothing, when its lines would open a table the config already has", async () => {
  const held = `${CONFIG}\n[tools.rumdl]\nline-length = 100\n`;
  const own = `${EXTENDS}disable = ["MD033"]\n`;
  const root = await repo({ [POLICY]: held, [ROOT]: own });
  const { exitCode, report } = await move(root, "adopt", { yes: true });
  expect(exitCode).toBe(1);
  expect(report.stopped?.[0]).toContain("by hand");
  expect(report.changed).toEqual([]);
  expect(await read(root, POLICY)).toBe(held);
  expect(await read(root, ROOT)).toBe(own);
});

test("eject fills a root config that holds the bare line with other line endings", async () => {
  const root = await repo({
    [POLICY]: `${CONFIG}\n[tools.rumdl.MD007]\nindent = 4\n`,
    [ROOT]: EXTENDS.replaceAll("\n", "\r\n\r\n"),
  });
  const { exitCode, report } = await move(root, "eject", { yes: true });
  expect(report.stopped ?? []).toEqual([]);
  expect(exitCode).toBe(0);
  expect(await read(root, ROOT)).toContain("[MD007]\nindent = 4\n");
});

test("eject leaves a bare line with a comment a person wrote beside it", async () => {
  const own = `# ours\n${EXTENDS}`;
  const root = await repo({
    [POLICY]: `${CONFIG}\n[tools.rumdl.MD007]\nindent = 4\n`,
    [ROOT]: own,
  });
  const { exitCode } = await move(root, "eject", { yes: true });
  expect(exitCode).toBe(1);
  expect(await read(root, ROOT)).toBe(own);
});

test("a pointer with other line endings is still Ropes' to replace", async () => {
  const root = await repo({
    [POLICY]: `${CONFIG}\n[tools.rumdl.MD007]\nindent = 4\n`,
  });
  const before = await read(root, ROOT);
  await Bun.write(`${root}/${ROOT}`, before.replaceAll("\n", "\r\n"));
  const { exitCode, report } = await move(root, "eject", { yes: true });
  expect(report.stopped ?? []).toEqual([]);
  expect(exitCode).toBe(0);
});
