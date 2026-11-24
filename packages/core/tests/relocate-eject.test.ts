import { afterAll, expect, test } from "bun:test";

import { markdownPaths } from "../src/adapters/rumdl/paths.ts";
import { pointerFor } from "../src/adapters/rumdl/root-config.ts";
import { commands } from "../src/commands/registry.ts";
import { ROPES_MANAGED_DIR } from "../src/contracts/managed-config.ts";
import {
  CINCH,
  CONFIG,
  EXTENDS,
  GENERATED,
  ROOT,
  SHARED,
  cleanUp,
  move,
  read,
  repo,
} from "./relocate-repo.ts";

const POINTER = pointerFor(markdownPaths(ROPES_MANAGED_DIR));

afterAll(cleanUp);

const TABLES = `
# Lists in this repository are indented by four.
[tools.rumdl.MD007]
indent = 4

[tools.rumdl.global]
# The vendored docs are not ours.
exclude = ["vendor/**"]
`;
const HELD = `${CONFIG}${TABLES}`;
const OWN = `${EXTENDS}
# Lists in this repository are indented by four.
[MD007]
indent = 4

[global]
# The vendored docs are not ours.
exclude = ["vendor/**"]
`;

test("the preview names every file and writes none", async () => {
  const root = await repo({ [CINCH]: HELD });
  const { exitCode, report } = await move(root, "eject");
  expect(exitCode).toBe(0);
  expect(report).toMatchObject({ action: "eject", written: false });
  expect(report.changed).toEqual([CINCH, GENERATED, ROOT]);
  expect(report.diff).toContain("+[MD007]");
  expect(await read(root, CINCH)).toBe(HELD);
  expect(await read(root, ROOT)).toBe(POINTER);
});

test("--yes moves the tables and their comments out, and a second run changes nothing", async () => {
  const root = await repo({ [CINCH]: HELD });
  const { exitCode, report } = await move(root, "eject", { yes: true });
  expect(exitCode).toBe(0);
  expect(report).toMatchObject({ notes: [], written: true });
  expect(await read(root, CINCH)).toBe(CONFIG);
  expect(await read(root, ROOT)).toBe(OWN);
  expect(await read(root, GENERATED)).not.toContain("MD007");
  const again = await move(root, "eject", { yes: true });
  expect(again.report).toMatchObject({ changed: [], written: false });
});

test("adopt undoes eject, to the byte", async () => {
  const root = await repo({ [CINCH]: HELD });
  await move(root, "eject", { yes: true });
  await move(root, "adopt", { yes: true });
  expect(await read(root, CINCH)).toBe(HELD);
  expect(await read(root, ROOT)).toBe(POINTER);
});

test("a root config the repository wrote is not overwritten", async () => {
  const root = await repo({ [CINCH]: HELD, [ROOT]: OWN });
  const { exitCode, report } = await move(root, "eject", { yes: true });
  expect(exitCode).toBe(1);
  expect(report.changed).toEqual([]);
  expect(report.stopped?.[0]).toContain(
    ".rumdl.toml is the repository's own, so Cinch will not overwrite it."
  );
  expect(await read(root, CINCH)).toBe(HELD);
  expect(await read(root, ROOT)).toBe(OWN);
});

test("a table written inline is not taken apart", async () => {
  const held = `${CONFIG}\n[tools]\nrumdl = { MD007 = { indent = 4 } }\n`;
  const root = await repo({ [CINCH]: held });
  const { report } = await move(root, "eject", { yes: true });
  expect(report.stopped?.[0]).toContain("Move it by hand.");
  expect(await read(root, CINCH)).toBe(held);
});

test("ejection refuses retired shared policy and retains unrelated tables", async () => {
  const shared = `[cinch]\npilot = 0\n\n[cinch.markdown]\nenabled = true\n\n[cinch.tools.rumdl.MD007]\nindent = 4\n\n[other]\nkept = true\n`;
  const root = await repo({ [SHARED]: shared });
  const response = await commands.preset?.({
    action: "eject",
    cwd: root,
    json: true,
    paths: ["markdown"],
    yes: true,
  });
  expect(response?.exitCode).toBe(2);
  expect(response?.error).toContain("[cinch]");
  expect(await read(root, SHARED)).toBe(shared);
  expect(await Bun.file(`${root}/${ROOT}`).exists()).toBe(false);
});

test("exactly one preset is named", async () => {
  const root = await repo({});
  const response = await commands.preset?.({
    action: "eject",
    cwd: root,
    json: true,
    paths: [],
  });
  expect(response?.exitCode).toBe(2);
});
