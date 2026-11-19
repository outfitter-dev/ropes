import { expect, test } from "bun:test";

import { Glob } from "bun";

import { compileGlob, compileGlobs } from "../src/policy/glob.ts";

const PATHS = [
  "README.md",
  "docs/guide.md",
  "docs/legacy/old.md",
  "docs/legacy/deep/older.md",
  "src/a.ts",
  "src/a.test.ts",
  "vendor/x/y.md",
  ".github/workflows/ci.yml",
  "a+b.md",
  "notes(1).md",
];

const PATTERNS = [
  "**/*.md",
  "*.md",
  "**",
  "docs/**",
  "docs/*.md",
  "docs/legacy/**",
  "**/legacy/**",
  "src/*.{ts,tsx}",
  "src/a.?s",
  "**/*.test.ts",
  "vendor/**/*.md",
  "[A-Z]*.md",
  "docs/[!g]*.md",
  "a+b.md",
  "notes(1).md",
  ".github/**",
];

test("the matcher agrees with Bun.Glob on every pattern and path", () => {
  const disagreements = PATTERNS.flatMap((pattern) => {
    const mine = compileGlob(pattern);
    const reference = new Glob(pattern);
    return PATHS.filter((path) => mine(path) !== reference.match(path)).map(
      (path) => `${pattern} on ${path}: got ${mine(path)}`
    );
  });
  expect(disagreements).toEqual([]);
});

test("a single star stays inside one path segment", () => {
  expect(compileGlob("*.md")("README.md")).toBe(true);
  expect(compileGlob("*.md")("docs/guide.md")).toBe(false);
});

test("an unclosed brace or bracket is matched literally", () => {
  expect(compileGlob("a{b")("a{b")).toBe(true);
  expect(compileGlob("a[b")("a[b")).toBe(true);
});

test("a stray closing bracket or brace is matched literally", () => {
  expect(compileGlob("docs/report].md")("docs/report].md")).toBe(true);
  expect(compileGlob("docs/a}b.md")("docs/a}b.md")).toBe(true);
  expect(compileGlob("docs/a}b.md")("docs/ab.md")).toBe(false);
});

test("no patterns match nothing", () => {
  expect(compileGlobs([])("README.md")).toBe(false);
});
