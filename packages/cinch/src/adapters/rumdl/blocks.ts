/**
 * What each line of a Markdown file is, as far as fenced blocks go. It is
 * enough of Markdown to tell a fence from text that only looks like one: a
 * fence may sit in a quote or a list item, even on the item's own line, a line
 * indented four or more columns past its container is code, and a backtick
 * fence has no backtick after its opening run.
 */
export interface Line {
  readonly kind: "open" | "inside" | "close" | "text";
  /** The line without its quote and list prefixes, trimmed. */
  readonly text: string;
}

const QUOTE = /^(?:\s{0,3}>\s?)+/u;
const ITEM = /^(?<marker>[-*+]|\d{1,9}[.)])(?<gap>\s+|$)/u;
const FENCE = /^(?<ticks>`{3,}|~{3,})(?<info>.*)$/u;
const TAB = 4;
const CODE_INDENT = 4;

const widthOf = (space: string): number =>
  space.length + (space.split("\t").length - 1) * (TAB - 1);

interface Fence {
  readonly char: string;
  readonly length: number;
}

/** An open fence, and the quote depth and list column it sits in. */
interface Open extends Fence {
  readonly base: number;
  readonly depth: number;
}

interface Quoted {
  readonly depth: number;
  readonly rest: string;
}

const unquote = (raw: string): Quoted => {
  const prefix = QUOTE.exec(raw)?.[0] ?? "";
  return {
    depth: prefix.split(">").length - 1,
    rest: raw.slice(prefix.length),
  };
};

const opens = (text: string): Fence | null => {
  const fence = FENCE.exec(text)?.groups;
  const ticks = fence?.ticks;
  if (ticks === undefined) {
    return null;
  }
  const char = ticks.charAt(0);
  return char === "`" && fence?.info?.includes("`") === true
    ? null
    : { char, length: ticks.length };
};

const closes = (text: string, open: Fence): boolean => {
  const fence = FENCE.exec(text)?.groups;
  return (
    fence?.ticks?.startsWith(open.char.repeat(open.length)) === true &&
    fence.info?.trim() === ""
  );
};

/**
 * Takes the list markers off the front of a line and says how far the rest
 * is indented past the innermost list item it belongs to. `items` holds the
 * content column of each open item and is kept up to date.
 */
const inItems = (
  line: string,
  items: number[]
): {
  readonly base: number;
  readonly indent: number;
  readonly text: string;
} => {
  let text = line.trimStart();
  let column = widthOf(line.slice(0, line.length - text.length));
  while (items.length > 0 && column < (items.at(-1) ?? 0)) {
    items.pop();
  }
  let base = items.at(-1) ?? 0;
  for (;;) {
    const item = ITEM.exec(text)?.groups;
    if (item === undefined || column - base >= CODE_INDENT) {
      break;
    }
    const gap = widthOf(item.gap ?? "");
    const lead = (item.marker?.length ?? 0) + (gap > CODE_INDENT ? 1 : gap);
    base = column + Math.max(lead, 2);
    column = base;
    items.push(base);
    text = text.slice((item.marker?.length ?? 0) + (item.gap?.length ?? 0));
  }
  return { base, indent: column - base, text: text.trim() };
};

/**
 * What a line is while a fence is open, or null when the line ends the quote
 * or list item the fence sits in, which ends the block with it. Only a fence
 * at the opener's own quote depth, indented less than code, closes the block.
 */
const within = (line: Quoted, open: Open): "close" | "inside" | null => {
  const text = line.rest.trim();
  const lead = line.rest.length - line.rest.trimStart().length;
  const column = widthOf(line.rest.slice(0, lead));
  if (line.depth > open.depth) {
    return "inside";
  }
  if (line.depth < open.depth || (text !== "" && column < open.base)) {
    return null;
  }
  return column - open.base < CODE_INDENT && closes(text, open)
    ? "close"
    : "inside";
};

/** Reads a Markdown file line by line. */
export const linesOf = (markdown: string): Line[] => {
  const items: number[] = [];
  let open: Open | null = null;
  return markdown.split("\n").map((raw): Line => {
    const line = unquote(raw);
    const kind = open === null ? null : within(line, open);
    if (kind !== null) {
      open = kind === "close" ? null : open;
      return { kind, text: line.rest.trim() };
    }
    if (line.rest.trim() === "") {
      open = null;
      return { kind: "text", text: "" };
    }
    const { base, indent, text } = inItems(line.rest, items);
    const fence = indent < CODE_INDENT ? opens(text) : null;
    open = fence === null ? null : { ...fence, base, depth: line.depth };
    return { kind: open === null ? "text" : "open", text };
  });
};
