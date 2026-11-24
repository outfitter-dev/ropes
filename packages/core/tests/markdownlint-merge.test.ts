import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { merge } from "../src/adapters/rumdl/migrate/markdownlint/merge.ts";
import {
  CONFIG_PATH,
  GENERATED_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { checkOne, fixOne } from "./one-file.ts";

const OLD = ".markdownlint.json";
const KNOWN = [
  { aliases: ["ul-indent"], code: "MD007", name: "ul-indent" },
  { aliases: ["line-length"], code: "MD013", name: "line-length" },
];
const MARK = `# Carried over from ${OLD} by Cinch.`;

const merged = (
  current: string,
  sections: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  notes: readonly string[] = []
): string => {
  const result = merge({ current, file: OLD, known: KNOWN, notes, sections });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.text;
};

test("a table the file lacks is added at the end", () => {
  expect(merged("[MD013]\nline-length = 100\n", { MD007: { indent: 4 } })).toBe(
    [
      "[MD013]",
      "line-length = 100",
      "",
      MARK,
      "# Only what differs from the Markdown standard is here.",
      "[MD007]",
      "indent = 4",
      "",
    ].join("\n")
  );
});

test("a new option goes under the header the file already has", () => {
  const current = "[MD013]\nline-length = 100\n\n[MD007]\nindent = 4\n";
  expect(merged(current, { MD013: { "code-blocks": false } })).toBe(
    [
      "[MD013]",
      MARK,
      "code-blocks = false",
      "line-length = 100",
      "",
      "[MD007]",
      "indent = 4",
      "",
    ].join("\n")
  );
});

test("a table under an alias is the same rule", () => {
  const text = merged("[line-length]\nline_length = 100\n", {
    MD013: { "code-blocks": false, "line-length": 100 },
  });
  expect(text).toBe(
    [
      "[line-length]",
      MARK,
      "code-blocks = false",
      "line_length = 100",
      "",
    ].join("\n")
  );
});

test("the file's value wins, and the other one is named", () => {
  const current = "[MD013]\nline-length = 100\n";
  expect(merged(current, { MD013: { "line-length": 120 } })).toBe(
    [
      "[MD013]",
      "line-length = 100",
      "",
      `# Not carried over from ${OLD}:`,
      `# - \`line-length\` on MD013 is 120 in ${OLD} and 100 here. The value here was kept.`,
      "",
    ].join("\n")
  );
});

test("a table written inline gets a note, not a second table", () => {
  const current = "MD013 = { line-length = 100 }\n";
  const text = merged(current, { MD013: { "code-blocks": false } });
  expect(text).toStartWith(current);
  expect(text).toContain(
    `\`code-blocks\` on MD013 is false in ${OLD}. Cinch could not add it to the MD013 settings here, so add it by hand.`
  );
  expect(text).not.toContain("[MD013]");
});

test("the lists of rules switched off are compared like any option", () => {
  const current = '[global]\ndisable = ["MD001"]\n';
  const text = merged(current, {
    global: { disable: ["MD002"], "extend-disable": ["MD003"] },
  });
  expect(text).toContain(`[global]\n${MARK}\nextend-disable = ["MD003"]`);
  expect(text).toContain('disable = ["MD001"]');
  expect(text).toContain(
    '`disable` on global is ["MD002"] in .markdownlint.json and ["MD001"] here.'
  );
});

test("a quoted header is the same table", () => {
  const text = merged('["MD013"]\nline-length = 100\n', {
    MD013: { "code-blocks": false },
  });
  expect(text).toBe(
    ['["MD013"]', MARK, "code-blocks = false", "line-length = 100", ""].join(
      "\n"
    )
  );
});

test("a value the preset sets is still named when the file differs", () => {
  const result = merge({
    current: "[MD007]\nindent = 4\n",
    file: OLD,
    known: KNOWN,
    notes: [],
    same: { MD007: { indent: 2 }, MD013: { "line-length": 80 } },
    sections: {},
  });
  expect(result).toEqual({
    notes: [
      `\`indent\` on MD007 is 2 in ${OLD} and 4 here. The value here was kept.`,
    ],
    ok: true,
    text: [
      "[MD007]",
      "indent = 4",
      "",
      `# Not carried over from ${OLD}:`,
      `# - \`indent\` on MD007 is 2 in ${OLD} and 4 here. The value here was kept.`,
      "",
    ].join("\n"),
  });
});

test("a rule the old config switched off and this list leaves on is named", () => {
  const result = merge({
    current: '[global]\ndisable = ["MD001", "line-length"]\n',
    file: OLD,
    known: KNOWN,
    notes: [],
    off: ["MD007", "MD013", "MD033"],
    sections: { global: { "extend-disable": ["MD033"] } },
  });
  expect(result.ok && result.text).toContain(
    `# - ${OLD} switches off MD007, and the \`disable\` list here does not. The list here was kept, and it replaces the standard's.`
  );
});

test("a rule the old config switched on and the lists here switch off is named", () => {
  const result = merge({
    current: '[global]\nenable = ["MD013"]\nextend-disable = ["ul-indent"]\n',
    file: OLD,
    known: KNOWN,
    notes: [],
    on: ["MD007", "MD013", "MD033"],
    sections: {},
  });
  expect(result.ok && result.notes).toEqual([
    `${OLD} switches on MD007, MD033, and the lists of rules here switch that off. The lists here were kept.`,
  ]);
});

test("nothing to add leaves the file as it was", () => {
  const current = "[MD013]\nline-length = 100\n";
  expect(merged(current, { MD013: { "line-length": 100 } })).toBe(current);
});

test("a line that would land inside a string stops the merge", () => {
  const current = 'note = """\n[MD013]\n"""\n\n[MD013]\nline-length = 100\n';
  const result = merge({
    current,
    file: OLD,
    known: KNOWN,
    notes: [],
    sections: { MD013: { "code-blocks": false } },
  });
  expect(result.ok).toBe(false);
});

const ready = Bun.which("rumdl") !== null;

test("init merges the old rules into a config, and doctor adds one line", async () => {
  if (!ready) {
    console.warn("skipped: rumdl is not on PATH, so the merge did not run");
    return;
  }
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-mrg-")));
  try {
    await mkdir(path.join(root, ".git"));
    await Bun.write(
      path.join(root, OLD),
      JSON.stringify({ MD007: { indent: 4 }, MD013: { line_length: 120 } })
    );
    const target = path.join(root, CONFIG_PATH);
    const preset = rumdlPresetAdapter();
    const mine = "[MD013]\nline-length = 100\n";
    await Bun.write(target, mine);
    const plain = await fixOne(preset, { path: CONFIG_PATH, root });
    expect(plain.status).toBe("fixed");
    expect(await Bun.file(target).text()).toBe(
      `extends = ${JSON.stringify(GENERATED_PATH)}\n\n${mine}`
    );
    await Bun.write(target, mine);
    const first = await fixOne(preset, {
      migrate: true,
      path: CONFIG_PATH,
      root,
    });
    expect(first.status).toBe("fixed");
    const text = await Bun.file(target).text();
    expect(text).toStartWith(
      `extends = ${JSON.stringify(GENERATED_PATH)}\n\n[MD013]\nline-length = 100\n`
    );
    expect(text).toContain("[MD007]\nindent = 4\n");
    expect(text).toContain(
      "`line-length` on MD013 is 120 in .markdownlint.json and 100 here."
    );
    const second = await checkOne(preset, { path: CONFIG_PATH, root });
    expect(second.status).toBe("passed");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
