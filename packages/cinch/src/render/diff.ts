import type { ChangeAt } from "../contracts/conflict.ts";

const CONTEXT = 3;
/** Past this many cells the table is not built and the middle is replaced. */
const MAX_CELLS = 4_000_000;
const NO_EOL = "\\ No newline at end of file";

type Kind = " " | "-" | "+";
interface Op {
  readonly kind: Kind;
  readonly line: string;
}

/** Lines keep their terminator, so a missing final newline is a difference. */
const linesOf = (text: string): string[] =>
  text.match(/[^\n]*\n|[^\n]+/gu) ?? [];

const same = (lines: readonly string[]): Op[] =>
  lines.map((line) => ({ kind: " ", line }));

/** Longest common subsequence over the part the two sides do not share. */
const middle = (old: readonly string[], next: readonly string[]): Op[] => {
  const removed: Op[] = old.map((line) => ({ kind: "-", line }));
  const added: Op[] = next.map((line) => ({ kind: "+", line }));
  const width = next.length + 1;
  if (old.length * next.length > MAX_CELLS) {
    return [...removed, ...added];
  }
  const table = new Uint32Array((old.length + 1) * width);
  const at = (row: number, column: number) => table[row * width + column] ?? 0;
  for (let row = old.length - 1; row >= 0; row -= 1) {
    for (let column = next.length - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        old[row] === next[column]
          ? at(row + 1, column + 1) + 1
          : Math.max(at(row + 1, column), at(row, column + 1));
    }
  }
  const ops: Op[] = [];
  let row = 0;
  let column = 0;
  while (row < old.length && column < next.length) {
    if (old[row] === next[column]) {
      ops.push({ kind: " ", line: old[row] ?? "" });
      row += 1;
      column += 1;
    } else if (at(row + 1, column) >= at(row, column + 1)) {
      ops.push({ kind: "-", line: old[row] ?? "" });
      row += 1;
    } else {
      ops.push({ kind: "+", line: next[column] ?? "" });
      column += 1;
    }
  }
  return [...ops, ...removed.slice(row), ...added.slice(column)];
};

const opsOf = (old: readonly string[], next: readonly string[]): Op[] => {
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }
  return [
    ...same(old.slice(0, head)),
    ...middle(
      old.slice(head, old.length - tail),
      next.slice(head, next.length - tail)
    ),
    ...same(old.slice(old.length - tail)),
  ];
};

/** Half-open ranges of ops: each change with its context, overlaps merged. */
const hunkRanges = (ops: readonly Op[]): [number, number][] => {
  const ranges: [number, number][] = [];
  for (const [index, op] of ops.entries()) {
    if (op.kind !== " ") {
      const start = Math.max(0, index - CONTEXT);
      const end = Math.min(ops.length, index + CONTEXT + 1);
      const last = ranges.at(-1);
      if (last && start <= last[1]) {
        last[1] = end;
      } else {
        ranges.push([start, end]);
      }
    }
  }
  return ranges;
};

const span = (start: number, length: number): string =>
  `${length === 0 ? start : start + 1},${length}`;

const count = (list: readonly Op[], not: Kind): number =>
  list.filter((op) => op.kind !== not).length;

const printed = (op: Op): string =>
  op.line.endsWith("\n")
    ? `${op.kind}${op.line}`
    : `${op.kind}${op.line}\n${NO_EOL}\n`;

const ESCAPES: Readonly<Record<string, string>> = {
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
  '"': '\\"',
  "\\": "\\\\",
};

/** A header path as git writes it: quoted when a character needs escaping. */
const header = (prefix: string, path: string): string => {
  const plain = `${prefix}/${path}`;
  const escaped = plain.replaceAll(
    /[\t\n\r"\\]/gu,
    (character) => ESCAPES[character] ?? character
  );
  return escaped === plain ? plain : `"${escaped}"`;
};

/**
 * The one-based lines of the new text a hunk changes. A removed line counts
 * as the line that now sits where it was, or as the last line left when it
 * was removed from the end.
 */
const touched = (ops: readonly Op[], start: number, end: number): number[] => {
  const last = Math.max(count(ops, "-"), 1);
  let line = count(ops.slice(0, start), "-");
  const lines: number[] = [];
  for (const op of ops.slice(start, end)) {
    if (op.kind !== "-") {
      line += 1;
    }
    if (op.kind !== " ") {
      lines.push(op.kind === "+" ? line : Math.min(line + 1, last));
    }
  }
  return lines;
};

const diffOf = (
  path: string,
  before: string,
  after: string,
  keep: (lines: readonly number[]) => boolean
): string => {
  if (before === after) {
    return "";
  }
  const ops = opsOf(linesOf(before), linesOf(after));
  const hunks = hunkRanges(ops)
    .filter(([start, end]) => keep(touched(ops, start, end)))
    .map(([start, end]) => {
      const lead = ops.slice(0, start);
      const body = ops.slice(start, end);
      const range = `@@ -${span(count(lead, "+"), count(body, "+"))} +${span(count(lead, "-"), count(body, "-"))} @@\n`;
      return range + body.map(printed).join("");
    });
  return hunks.length === 0
    ? ""
    : `--- ${header("a", path)}\n+++ ${header("b", path)}\n${hunks.join("")}`;
};

/**
 * A unified diff of one file, in the form `git diff` prints. Empty when the
 * two texts are the same.
 */
export const unifiedDiff = (
  path: string,
  before: string,
  after: string
): string => diffOf(path, before, after, () => true);

/**
 * The hunks of that diff that change a line of the new text inside a span.
 * Empty when the change leaves those lines alone.
 */
export const changeAt: ChangeAt = (path, before, after, { from, to }) =>
  diffOf(path, before, after, (lines) =>
    lines.some((line) => line >= from && line <= to)
  );
