import { expect, test } from "bun:test";

import { translate } from "../src/adapters/rumdl/markdownlint-translate.ts";
import type { Sections } from "../src/adapters/rumdl/markdownlint-translate.ts";
import { render } from "../src/adapters/rumdl/markdownlint.ts";

const known = [
  { aliases: [], code: "MD001", name: "heading-increment" },
  { aliases: ["ul-style"], code: "MD004", name: "ul-style" },
  { aliases: [], code: "MD007", name: "ul-indent" },
  { aliases: [], code: "MD013", name: "line-length" },
  { aliases: [], code: "MD024", name: "no-duplicate-heading" },
  { aliases: [], code: "MD033", name: "no-inline-html" },
];

const preset: Sections = {
  MD004: { style: "dash" },
  MD007: { indent: 2 },
  MD024: { siblings_only: true },
  global: { disable: ["MD013", "MD033"] },
};

const run = (rules: Record<string, unknown>, imported: Sections) =>
  translate({ imported, known, preset, rules });

test("a rule switched off under an alias matches the preset's entry", () => {
  const result = run(
    { "no-inline-html": false },
    { global: { disable: ["no-inline-html"] } }
  );
  expect(result).toEqual({ notes: [], sections: {} });
});

test("a rule the preset leaves on stays off without replacing the list", () => {
  const result = run(
    { MD001: false, MD033: false },
    { global: { disable: ["MD001", "MD033"] } }
  );
  expect(result.sections).toEqual({ global: { "extend-disable": ["MD001"] } });
});

test("a rule the preset switches off stays on when the old config set it", () => {
  const result = run(
    { MD001: false, "line-length": { line_length: 120 } },
    {
      global: { disable: ["MD001"] },
      "line-length": { "line-length": 120 },
    }
  );
  expect(result.sections).toEqual({
    MD013: { "line-length": 120 },
    global: { disable: ["MD001", "MD033"] },
  });
});

test("a value the preset already sets is dropped, whatever the key's spelling", () => {
  const result = run(
    { MD007: { indent: 2 }, MD024: { siblings_only: true } },
    { MD007: { indent: 2 }, MD024: { "siblings-only": true } }
  );
  expect(result).toEqual({ notes: [], sections: {} });
});

test("a value that differs is kept, and one the engine added is not", () => {
  const result = run(
    { MD007: { indent: 4 }, "ul-style": { style: "asterisk" } },
    {
      MD007: { indent: 4, style: "fixed" },
      "ul-style": { style: "asterisk" },
    }
  );
  expect(result.sections).toEqual({
    MD004: { style: "asterisk" },
    MD007: { indent: 4 },
  });
});

test("what has no equivalent is named", () => {
  const result = run(
    {
      $schema: "https://example.test/schema.json",
      MD007: { indent: 2, start_indented: true },
      default: true,
      extends: "./base.json",
      "my-rule": true,
    },
    { MD007: { indent: 2 } }
  );
  expect(result.sections).toEqual({});
  expect(result.notes).toEqual([
    "`extends` names another config, ./base.json, which was not read.",
    "`my-rule` is not a rule the new linter has. It may be a custom rule or a tag.",
    "`start_indented` on MD007 has no equivalent here.",
  ]);
});

test("an empty `extends` is not worth a note", () => {
  expect(run({ extends: null }, {})).toEqual({ notes: [], sections: {} });
});

test("a config that only allows some rules keeps that list", () => {
  const result = run(
    { MD001: true, default: false },
    { global: { enable: ["MD001"] } }
  );
  expect(result.sections).toEqual({ global: { enable: ["MD001"] } });
});

test("nothing to say renders as nothing", () => {
  expect(render("old.json", { notes: [], sections: {} })).toBe("");
});

test("the rendered text names its source and lists what was left out", () => {
  const text = render("old.json", {
    notes: ["`x` was left out."],
    sections: { MD007: { indent: 4 }, global: { "extend-disable": ["MD001"] } },
  });
  expect(text).toBe(
    [
      "",
      "# Carried over from old.json by Cinch.",
      "# Only what differs from the Markdown standard is here.",
      "[global]",
      'extend-disable = ["MD001"]',
      "",
      "[MD007]",
      "indent = 4",
      "",
      "# Not carried over from old.json:",
      "# - `x` was left out.",
      "",
    ].join("\n")
  );
});
