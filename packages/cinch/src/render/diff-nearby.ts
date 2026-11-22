import type { Op } from "./diff-lines.ts";

/** Equally short gap alignments prefer matching a line near its old position. */
const choicesFor = (
  old: readonly string[],
  next: readonly string[],
  oldStart: number,
  nextStart: number
): Uint8Array => {
  const width = next.length + 1;
  const size = (old.length + 1) * width;
  const lengths = new Uint32Array(size);
  const costs = new Float64Array(size);
  const choices = new Uint8Array(size);
  for (let row = old.length - 1; row >= 0; row -= 1) {
    for (let column = next.length - 1; column >= 0; column -= 1) {
      const index = row * width + column;
      const down = index + width;
      const right = index + 1;
      let length = lengths[down] ?? 0;
      let cost = costs[down] ?? 0;
      let choice = 1;
      const better = (candidateLength: number, candidateCost: number) =>
        candidateLength > length ||
        (candidateLength === length && candidateCost < cost);
      if (better(lengths[right] ?? 0, costs[right] ?? 0)) {
        length = lengths[right] ?? 0;
        cost = costs[right] ?? 0;
        choice = 2;
      }
      if (old[row] === next[column]) {
        const matchedLength = (lengths[down + 1] ?? 0) + 1;
        const matchedCost =
          (costs[down + 1] ?? 0) +
          Math.abs(oldStart + row - nextStart - column);
        if (
          matchedLength > length ||
          (matchedLength === length && matchedCost <= cost)
        ) {
          length = matchedLength;
          cost = matchedCost;
          choice = 0;
        }
      }
      lengths[index] = length;
      costs[index] = cost;
      choices[index] = choice;
    }
  }
  return choices;
};

export const nearbyDiff = (
  old: readonly string[],
  next: readonly string[],
  oldStart: number,
  nextStart: number
): Op[] => {
  const width = next.length + 1;
  const choices = choicesFor(old, next, oldStart, nextStart);
  const ops: Op[] = [];
  let row = 0;
  let column = 0;
  while (row < old.length && column < next.length) {
    const choice = choices[row * width + column];
    if (choice === 0) {
      ops.push({ kind: " ", line: old[row] ?? "" });
      row += 1;
      column += 1;
    } else if (choice === 1) {
      ops.push({ kind: "-", line: old[row] ?? "" });
      row += 1;
    } else {
      ops.push({ kind: "+", line: next[column] ?? "" });
      column += 1;
    }
  }
  return [
    ...ops,
    ...old.slice(row).map((line): Op => ({ kind: "-", line })),
    ...next.slice(column).map((line): Op => ({ kind: "+", line })),
  ];
};
