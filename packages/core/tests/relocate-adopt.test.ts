import { afterAll, expect, test } from "bun:test";

import { markdownPaths } from "../src/adapters/rumdl/paths.ts";
import { pointerFor } from "../src/adapters/rumdl/root-config.ts";
import { commands } from "../src/commands/registry.ts";
import { ROPES_MANAGED_DIR } from "../src/contracts/managed-config.ts";
import {
  POLICY,
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

const OWN = `${EXTENDS}
# Lists in this repository are indented by four.
[MD007]
indent = 4

[global]
# The vendored docs are not ours.
exclude = ["vendor/**"]
`;

test("the preview names every file and writes none", async () => {
  const root = await repo({ [ROOT]: OWN });
  const { exitCode, report } = await move(root, "adopt");
  expect(exitCode).toBe(0);
  expect(report.written).toBe(false);
  expect(report.changed).toEqual([POLICY, GENERATED, ROOT]);
  expect(report.diff).toContain("+[tools.rumdl.MD007]");
  expect(await read(root, ROOT)).toBe(OWN);
  expect(await read(root, POLICY)).toBe(CONFIG);
});

test("--yes moves the settings and their comments, and a second run changes nothing", async () => {
  const root = await repo({ [ROOT]: OWN });
  const { exitCode, report } = await move(root, "adopt", { yes: true });
  expect(exitCode).toBe(0);
  expect(report).toMatchObject({ notes: [], written: true });
  expect(await read(root, ROOT)).toBe(POINTER);
  expect(await read(root, POLICY)).toBe(`${CONFIG}
# Lists in this repository are indented by four.
[tools.rumdl.MD007]
indent = 4

[tools.rumdl.global]
# The vendored docs are not ours.
exclude = ["vendor/**"]
`);
  expect(await read(root, GENERATED)).toContain("[MD007]\nindent = 4\n");
  const again = await move(root, "adopt", { yes: true });
  expect(again.report).toMatchObject({ changed: [], written: false });
});

test("--dry-run wins over --yes", async () => {
  const root = await repo({ [ROOT]: OWN });
  const { report } = await move(root, "adopt", { dryRun: true, yes: true });
  expect(report.written).toBe(false);
  expect(await read(root, ROOT)).toBe(OWN);
});

test("a setting that only repeats the preset is left out, and said so", async () => {
  const root = await repo({
    [ROOT]: `${EXTENDS}
[MD007]
# Two, as everywhere.
indent = 2
start-indented = true

# Dashes.
[MD004]
style = "dash"
`,
  });
  const { report } = await move(root, "adopt", { yes: true });
  expect(await read(root, POLICY)).toBe(
    `${CONFIG}\n[tools.rumdl.MD007]\nstart-indented = true\n`
  );
  expect(report.notes).toEqual([
    "Left out, because the layer below already says the same: MD007.indent, MD004.style.",
    "These comments in .rumdl.toml were not carried over:\n  # Two, as everywhere.\n  # Dashes.",
  ]);
});

test("a file that holds nothing new becomes the pointer, and the config is left alone", async () => {
  const root = await repo({ [ROOT]: `${EXTENDS}\n[MD007]\nindent = 2\n` });
  const { report } = await move(root, "adopt", { yes: true });
  expect(report.changed).toEqual([ROOT]);
  expect(await read(root, ROOT)).toBe(POINTER);
});

test("a value on several lines moves as it is written", async () => {
  const root = await repo({
    [ROOT]: `${EXTENDS}\n[global]\nexclude = [\n  "vendor/**", # theirs\n  "out/**",\n]\n`,
  });
  await move(root, "adopt", { yes: true });
  expect(await read(root, POLICY)).toContain(
    '[tools.rumdl.global]\nexclude = [\n  "vendor/**", # theirs\n  "out/**",\n]\n'
  );
});

test("when the lines cannot be kept, the settings are written afresh and the comments listed", async () => {
  const root = await repo({
    [ROOT]: `${EXTENDS}
[MD080]
# Only the first two.
levels = [1, 2]
# GitHub, on two lines.
anchor-style = """
github"""
`,
  });
  const { report } = await move(root, "adopt", { yes: true });
  expect(await read(root, POLICY)).toBe(
    `${CONFIG}\n[tools.rumdl.MD080]\nlevels = [1, 2]\n`
  );
  expect(report.notes[1]).toContain("# Only the first two.");
});

test("a setting the Ropes config states differently stops the move", async () => {
  const config = `${CONFIG}\n[tools.rumdl.MD007]\nindent = 3\n`;
  const root = await repo({ [POLICY]: config, [ROOT]: OWN });
  const { exitCode, report } = await move(root, "adopt", { yes: true });
  expect(exitCode).toBe(1);
  expect(report.changed).toEqual([]);
  expect(report.stopped).toEqual([
    "`MD007.indent` is set in .rumdl.toml and in `[tools.rumdl]` in rope.toml, to different values. Remove one of the two, then run this again.",
  ]);
  expect(await read(root, ROOT)).toBe(OWN);
  expect(await read(root, POLICY)).toBe(config);
});

test("a table the Ropes config already has stops the move, with the keys to move by hand", async () => {
  const config = `${CONFIG}\n[tools.rumdl.MD007]\nstart-indented = true\n`;
  const root = await repo({ [POLICY]: config, [ROOT]: OWN });
  const { report } = await move(root, "adopt", { yes: true });
  expect(report.stopped).toEqual([
    "rope.toml already has a `MD007` table under `[tools.rumdl]`. Move `indent` from `[MD007]` in .rumdl.toml into it by hand, then run this again.",
  ]);
});

test("a root config that does not extend the generated one is sent to doctor", async () => {
  const root = await repo({});
  await Bun.write(`${root}/${ROOT}`, "[MD007]\nindent = 4\n");
  const { report } = await move(root, "adopt", { yes: true });
  expect(report.stopped?.[0]).toContain("Run `rope doctor --fix` first.");
});

test("adoption refuses retired shared policy without rewriting authored files", async () => {
  const shared = "[cinch]\npilot = 0\n\n[cinch.markdown]\nenabled = true\n";
  const root = await repo({ [ROOT]: OWN, [SHARED]: shared });
  const response = await commands.preset?.({
    action: "adopt",
    cwd: root,
    json: true,
    paths: ["markdown"],
    yes: true,
  });
  expect(response?.exitCode).toBe(2);
  expect(response?.error).toContain("[cinch]");
  expect(await read(root, SHARED)).toBe(shared);
  expect(await read(root, ROOT)).toBe(OWN);
});
