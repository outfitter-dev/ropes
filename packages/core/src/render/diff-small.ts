import type { Op } from "./diff-lines.ts";

/** Longest common subsequence over the part the two sides do not share. */
export const smallDiff = (
  old: readonly string[],
  next: readonly string[]
): Op[] => {
  const removed: Op[] = old.map((line) => ({ kind: "-", line }));
  const added: Op[] = next.map((line) => ({ kind: "+", line }));
  const width = next.length + 1;
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
