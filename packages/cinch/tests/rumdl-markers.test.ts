import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { rumdlAdapter } from "../src/adapters/rumdl/adapter.ts";
import {
  MARKER,
  UNKNOWN_RULE,
  UNUSED_RULE,
  withMarkers,
} from "../src/adapters/rumdl/markers.ts";
import type { Finding } from "../src/contracts/finding.ts";
import { checkOne } from "./one-file.ts";

const CONTEXT = { path: "a.md", source: "rumdl" };
const at = (line: number, rule: string): Finding => ({
  fixable: false,
  message: "m",
  path: "a.md",
  range: { start: { column: 1, line } },
  rule,
  severity: "error",
  source: "rumdl",
});
const PARSE = "code-block-parse";
const FRAGMENT = "```ts\nfoo: 1,\n```\n";
const read = (text: string, findings: readonly Finding[]) =>
  withMarkers(text, findings, CONTEXT).map(
    ({ range, rule }) => `${range.start.line} ${rule}`
  );

test("the marker is written the way the engine writes its own", () => {
  expect(MARKER).toBe("<!-- cinch-disable-next-line code-block-parse -->");
});

test("a file with no marker keeps its findings", () => {
  expect(read(`# A\n\n${FRAGMENT}`, [at(3, PARSE), at(1, "MD001")])).toEqual([
    `3 ${PARSE}`,
    "1 MD001",
  ]);
});

test("a marked fragment is no finding, and other findings stay", () => {
  const text = `# A\n\n${MARKER}\n${FRAGMENT}\n${FRAGMENT}`;
  expect(read(text, [at(1, "MD001"), at(4, PARSE), at(8, PARSE)])).toEqual([
    "1 MD001",
    `8 ${PARSE}`,
  ]);
});

test("a marker in a list or a quote is read where it is", () => {
  const text = `- item\n\n  ${MARKER}\n  \`\`\`ts\n  foo: 1,\n  \`\`\`\n\n> ${MARKER}\n> \`\`\`ts\n> a: 1,\n> \`\`\`\n`;
  expect(read(text, [at(4, PARSE)])).toEqual([]);
});

test("a marker above a block that parses is a finding on the marker's line", () => {
  const found = withMarkers(`# A\n\n${MARKER}\n${FRAGMENT}`, [], CONTEXT);
  expect(found).toEqual([
    {
      ...at(3, UNUSED_RULE),
      message:
        "This comment does nothing: the code block below it parses. Remove it.",
    },
  ]);
});

test("a marker that is not right above a fence is a finding, and excuses nothing", () => {
  const text = `${MARKER}\n\n${FRAGMENT}\n${MARKER}\nText.\n`;
  const found = withMarkers(text, [at(3, PARSE)], CONTEXT);
  expect(found.map(({ range, rule }) => `${range.start.line} ${rule}`)).toEqual(
    [`1 ${UNUSED_RULE}`, `3 ${PARSE}`, `7 ${UNUSED_RULE}`]
  );
  expect(found[0]?.message).toBe(
    "This comment does nothing: it is not on the line above a fenced code block. Move or remove it."
  );
});

test("a misspelled marker is a finding that names the right one, and excuses nothing", () => {
  const text = `<!-- cinch-disable-next-line code-block-pars -->\n${FRAGMENT}\n<!--cinch-ignore-->\n${FRAGMENT}`;
  const found = withMarkers(text, [at(2, PARSE), at(7, PARSE)], CONTEXT);
  expect(found.map(({ range, rule }) => `${range.start.line} ${rule}`)).toEqual(
    [`1 ${UNKNOWN_RULE}`, `2 ${PARSE}`, `6 ${UNKNOWN_RULE}`, `7 ${PARSE}`]
  );
  expect(found[0]?.message).toBe(
    `Cinch does not know the comment \`cinch-disable-next-line code-block-pars\`. The one it reads is \`${MARKER}\`.`
  );
});

test("extra spaces in the marker are fine", () => {
  const text = `<!--   cinch-disable-next-line   code-block-parse   -->\n${FRAGMENT}`;
  expect(read(text, [at(2, PARSE)])).toEqual([]);
});

test("a marker shown inside a fenced block is text, not a marker", () => {
  const text = `\`\`\`\`md\n${MARKER}\n\`\`\`ts\nfoo: 1,\n\`\`\`\n\`\`\`\`\n\n~~~md\n<!-- cinch-typo -->\n~~~\n`;
  expect(read(text, [])).toEqual([]);
});

test("another tool's comment is not Cinch's to judge", () => {
  expect(
    read("<!-- rumdl-disable-next-line MD001 -->\n<!-- a cinch- note -->\n", [])
  ).toEqual([]);
});

const PRESET = path.join(import.meta.dir, "..", "presets", "rumdl.toml");

test("on the real engine a fragment passes with the marker and fails without it", async () => {
  if (Bun.which("rumdl") === null || Bun.which("bun") === null) {
    console.warn(
      "skipped: rumdl or bun is not on PATH, so the fragment marker did not run against them"
    );
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), "cinch-marker-"));
  try {
    await Bun.write(
      path.join(root, ".rumdl.toml"),
      `extends = ${JSON.stringify(PRESET)}\n`
    );
    const check = async (text: string) => {
      await Bun.write(path.join(root, "a.md"), text);
      const outcome = await checkOne(rumdlAdapter(), { path: "a.md", root });
      return outcome.findings.map(
        ({ range, rule }) => `${range.start.line} ${rule}`
      );
    };
    expect(await check(`# A\n\n${FRAGMENT}`)).toEqual([`3 ${PARSE}`]);
    expect(await check(`# A\n\n${MARKER}\n${FRAGMENT}`)).toEqual([]);
    expect(
      await check(`# A\n\n${MARKER}\n\`\`\`ts\nconst a = 1;\n\`\`\`\n`)
    ).toEqual([`3 ${UNUSED_RULE}`]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
