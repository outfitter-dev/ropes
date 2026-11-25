import { expect, test } from "bun:test";

import { decode } from "../src/adapters/editor-text/decode.ts";
import { checkLines, columns } from "../src/adapters/editor-text/lines.ts";
import { settingsFor } from "../src/adapters/editor-text/settings.ts";

test("empty text stays empty and indentation size works independently of style", () => {
  expect(checkLines("", { final_newline: true, line_width: 2 })).toEqual([]);
  expect(decode(new Uint8Array(), "utf-8-bom")).toEqual({ text: "" });
  expect(
    checkLines("   wrong\n", { indent_size: 2 }).map((one) => one.setting)
  ).toEqual(["indent_size"]);
  expect(checkLines("\tallowed\n", { indent_size: 2 })).toEqual([]);
  expect(
    checkLines("  wrong\n", { indent_style: "tab" }).map((one) => one.setting)
  ).toEqual(["indent_style"]);
});

test("display width measures decoded Unicode and expands tabs", () => {
  expect(checkLines("café!\n", { line_width: 5 })).toEqual([]);
  expect(columns("e\u0301界", 4)).toBe(3);
  expect(columns("a\tb", 4)).toBe(5);
  expect(
    checkLines("\tx", { line_width: 8 }).map((one) => one.setting)
  ).toEqual(["line_width"]);
  expect(checkLines("\tx", { indent_size: 2, line_width: 3 })).toEqual([]);
  expect(
    checkLines("界界界\n", { line_width: 5 }).map((one) => one.setting)
  ).toEqual(["line_width"]);
});

test("long lines and CR-only files cannot skip later findings", () => {
  expect(
    checkLines("x".repeat(70_000), { line_width: 100 }).map(
      (one) => one.setting
    )
  ).toEqual(["line_width"]);
  expect(
    checkLines("ok\r\tbad\r", { end_of_line: "cr", indent_style: "space" })
  ).toEqual([
    {
      line: 2,
      message: "use the declared indent_style",
      setting: "indent_style",
    },
  ]);
  expect(
    checkLines("ok\r\n", { end_of_line: "lf" }).map((one) => one.setting)
  ).toEqual(["end_of_line"]);
});

test("all supported charsets decode strictly and BOM policy remains visible", () => {
  expect(decode(new Uint8Array([0xe9]), "latin1")).toEqual({ text: "é" });
  expect(decode(new Uint8Array([0xff, 0xfe, 0x61, 0]), "utf-16le")).toEqual({
    text: "a",
  });
  expect(decode(new Uint8Array([0xfe, 0xff, 0, 0x61]), "utf-16be")).toEqual({
    text: "a",
  });
  expect(decode(new Uint8Array([0x61, 0]), "utf-16le")).toEqual({ text: "a" });
  expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), "utf-8-bom")).toEqual(
    { text: "a" }
  );
  expect(decode(new Uint8Array([0x61]), "utf-8-bom").problem).toBeDefined();
  expect(
    decode(new Uint8Array([0xff, 0xfe, 0x61, 0]), "utf-8").problem
  ).toBeDefined();
  expect(decode(new Uint8Array([0xff]), "utf-8").problem).toBeDefined();
  expect(decode(new Uint8Array([0, 0xd8]), "utf-16le").problem).toBeDefined();
  expect(decode(new Uint8Array([0xff])).incomplete).toBeDefined();
  expect(decode(new Uint8Array([0, 0])).incomplete).toBeDefined();
});

test("editor sections use basename matching, root paths, braces and ordered fact overrides", () => {
  const settings = {
    final_newline: true,
    indent_size: 2,
    overrides: [
      { files: ["*.txt"], indent_size: 3 },
      { files: ["nested/*.{txt,log}"], final_newline: false },
      { files: ["item{1..3}.txt"], line_width: 5 },
      { files: ["a**b.txt"], trim_trailing_whitespace: false },
    ],
  };
  expect(settingsFor(settings, "nested/deep/file.txt").indent_size).toBe(3);
  expect(settingsFor(settings, "nested/file.txt").final_newline).toBe(false);
  expect(settingsFor(settings, "other/nested/file.txt").final_newline).toBe(
    true
  );
  expect(settingsFor(settings, "nested/item2.txt").line_width).toBe(5);
  expect(settingsFor(settings, "a/x/y/b.txt").trim_trailing_whitespace).toBe(
    false
  );
});
