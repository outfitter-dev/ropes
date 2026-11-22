import { nearbyDiff } from "./diff-nearby.ts";
import { smallDiff } from "./diff-small.ts";

/** Keep the existing shortest alignment within a bounded allocation. */
const MAX_CELLS = 4_000_000;
/** Bound cumulative anchor scans to eight times the input line count. */
const ANCHOR_PASSES = 8;

export type Kind = " " | "-" | "+";
export interface Op {
  readonly kind: Kind;
  readonly line: string;
}

interface Region {
  readonly anchored?: boolean;
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly nextStart: number;
  readonly nextEnd: number;
}

/** A repeated line has no unique position in this region. */
const unique = (ids: readonly number[], start: number, end: number) => {
  const positions = new Map<number, number>();
  for (let index = start; index < end; index += 1) {
    const id = ids[index] ?? -1;
    positions.set(id, positions.has(id) ? -1 : index);
  }
  return positions;
};

/** Patience anchors are the longest ordered chain of lines unique on both sides. */
const anchors = (
  old: readonly number[],
  next: readonly number[],
  region: Region
): [number, number][] => {
  const left = unique(old, region.oldStart, region.oldEnd);
  const right = unique(next, region.nextStart, region.nextEnd);
  const pairs: [number, number][] = [];
  for (const [id, position] of left) {
    const other = right.get(id);
    if (position >= 0 && other !== undefined && other >= 0) {
      pairs.push([position, other]);
    }
  }
  const tails: number[] = [];
  const previous: number[] = [];
  for (const [index, pair] of pairs.entries()) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((pairs[tails[middle] ?? -1]?.[1] ?? -1) < pair[1]) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    previous[index] = tails[low - 1] ?? -1;
    tails[low] = index;
  }
  const ordered: [number, number][] = [];
  let index = tails.at(-1) ?? -1;
  while (index >= 0) {
    const pair = pairs[index];
    if (pair !== undefined) {
      ordered.push(pair);
    }
    index = previous[index] ?? -1;
  }
  return ordered.toReversed();
};

/**
 * Split large regions around unchanged anchors before using the bounded LCS.
 * An ambiguous region can be replaced without swallowing its known neighbors.
 * The work stack avoids call-stack growth on adversarially nested regions.
 */
export const lineOps = (
  old: readonly string[],
  next: readonly string[]
): Op[] => {
  const ids = new Map<string, number>();
  const intern = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const oldIds = old.map(intern);
  const nextIds = next.map(intern);
  const pending: Region[] = [
    { nextEnd: next.length, nextStart: 0, oldEnd: old.length, oldStart: 0 },
  ];
  const ops: Op[] = [];
  let anchorBudget = ANCHOR_PASSES * (old.length + next.length);
  while (pending.length > 0) {
    const region = pending.pop();
    if (region === undefined) {
      break;
    }
    let { oldStart, oldEnd, nextStart, nextEnd } = region;
    while (
      oldStart < oldEnd &&
      nextStart < nextEnd &&
      oldIds[oldStart] === nextIds[nextStart]
    ) {
      ops.push({ kind: " ", line: old[oldStart] ?? "" });
      oldStart += 1;
      nextStart += 1;
    }
    const tail = { nextEnd, nextStart: nextEnd, oldEnd, oldStart: oldEnd };
    while (
      oldStart < oldEnd &&
      nextStart < nextEnd &&
      oldIds[oldEnd - 1] === nextIds[nextEnd - 1]
    ) {
      oldEnd -= 1;
      nextEnd -= 1;
    }
    if (oldEnd < tail.oldEnd) {
      pending.push({ ...tail, nextStart: nextEnd, oldStart: oldEnd });
    }
    const left = old.slice(oldStart, oldEnd);
    const right = next.slice(nextStart, nextEnd);
    if (left.length * right.length <= MAX_CELLS) {
      const compared =
        region.anchored === true
          ? nearbyDiff(left, right, oldStart, nextStart)
          : smallDiff(left, right);
      for (const op of compared) {
        ops.push(op);
      }
      continue;
    }
    const work = left.length + right.length;
    const points =
      work > anchorBudget
        ? []
        : anchors(oldIds, nextIds, {
            nextEnd,
            nextStart,
            oldEnd,
            oldStart,
          });
    anchorBudget = Math.max(0, anchorBudget - work);
    if (points.length === 0) {
      for (const line of left) {
        ops.push({ kind: "-", line });
      }
      for (const line of right) {
        ops.push({ kind: "+", line });
      }
      continue;
    }
    const gaps: Region[] = [];
    for (const [oldIndex, nextIndex] of points) {
      gaps.push({
        anchored: true,
        nextEnd: nextIndex,
        nextStart,
        oldEnd: oldIndex,
        oldStart,
      });
      // Include the anchor in the following region's shared prefix.
      oldStart = oldIndex;
      nextStart = nextIndex;
    }
    gaps.push({ anchored: true, nextEnd, nextStart, oldEnd, oldStart });
    for (const gap of gaps.toReversed()) {
      pending.push(gap);
    }
  }
  return ops;
};
