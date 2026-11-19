/**
 * A small glob matcher for root-relative paths. The policy layer performs no
 * I/O and names no runtime, so it cannot borrow the runtime's own glob. The
 * tests hold this matcher to the same answers as that one.
 *
 * Supported: `*` (within one segment), `**` (across segments), `?`, `{a,b}`
 * and `[abc]`. A pattern matches the whole path, so `*.md` matches only at
 * the root. Dotfiles are not special.
 */
export type Matcher = (path: string) => boolean;

const SPECIAL = /[.+^$()|\\\]}]/gu;

const escape = (text: string): string => text.replaceAll(SPECIAL, "\\$&");

const closing = (pattern: string, from: number, close: string): number =>
  pattern.indexOf(close, from + 1);

interface Piece {
  readonly source: string;
  readonly next: number;
}

const star = (pattern: string, index: number): Piece => {
  if (pattern[index + 1] !== "*") {
    return { next: index + 1, source: "[^/]*" };
  }
  const startsSegment = index === 0 || pattern[index - 1] === "/";
  return startsSegment && pattern[index + 2] === "/"
    ? { next: index + 3, source: "(?:.*/)?" }
    : { next: index + 2, source: ".*" };
};

type Convert = (pattern: string) => string;

/** Alternatives are converted with `convert`, so they may hold wildcards. */
const braces = (pattern: string, index: number, convert: Convert): Piece => {
  const end = closing(pattern, index, "}");
  if (end === -1) {
    return { next: index + 1, source: "\\{" };
  }
  const alternatives = pattern
    .slice(index + 1, end)
    .split(",")
    .map((alternative) => convert(alternative));
  return { next: end + 1, source: `(?:${alternatives.join("|")})` };
};

interface Member {
  readonly char: string;
  readonly escaped: boolean;
}

interface CharacterClass {
  readonly members: readonly Member[];
  readonly negated: boolean;
  readonly next: number;
}

/** Reads `[...]` from `index`. A backslash makes the next character literal. */
const readClass = (
  pattern: string,
  index: number
): CharacterClass | undefined => {
  let cursor = index + 1;
  const negated = pattern[cursor] === "!" || pattern[cursor] === "^";
  cursor += negated ? 1 : 0;
  const members: Member[] = [];
  while (cursor < pattern.length) {
    const escaped = pattern[cursor] === "\\" && cursor + 1 < pattern.length;
    cursor += escaped ? 1 : 0;
    const char = String.fromCodePoint(pattern.codePointAt(cursor) ?? 0);
    if (char === "]" && !escaped) {
      return { members, negated, next: cursor + 1 };
    }
    members.push({ char, escaped });
    cursor += char.length;
  }
  return undefined;
};

const code = (member: Member | undefined): number =>
  member?.char.codePointAt(0) ?? 0;

const point = (value: number): string => `\\u{${value.toString(16)}}`;

/**
 * Every member is written as a code point escape, so nothing a user types can
 * be read as regular expression syntax. A range that runs backwards matches
 * nothing instead of failing to compile.
 */
const classSource = (members: readonly Member[]): string => {
  let source = "";
  let index = 0;
  while (index < members.length) {
    const dash = members[index + 1];
    const isRange =
      dash?.char === "-" && !dash.escaped && index + 2 < members.length;
    const low = code(members[index]);
    const high = isRange ? code(members[index + 2]) : low;
    source += low < high ? `${point(low)}-${point(high)}` : "";
    source += low === high ? point(low) : "";
    index += isRange ? 3 : 1;
  }
  return source;
};

const brackets = (pattern: string, index: number): Piece => {
  const parsed = readClass(pattern, index);
  if (parsed === undefined) {
    return { next: index + 1, source: "\\[" };
  }
  const source = classSource(parsed.members);
  if (parsed.negated) {
    return { next: parsed.next, source: `[^/${source}]` };
  }
  return {
    next: parsed.next,
    source: source === "" ? "(?!)" : `(?!/)[${source}]`,
  };
};

const pieceAt = (pattern: string, index: number, convert: Convert): Piece => {
  const char = pattern[index] ?? "";
  if (char === "*") {
    return star(pattern, index);
  }
  if (char === "?") {
    return { next: index + 1, source: "[^/]" };
  }
  if (char === "{") {
    return braces(pattern, index, convert);
  }
  if (char === "[") {
    return brackets(pattern, index);
  }
  return { next: index + 1, source: escape(char) };
};

const toSource: Convert = (pattern) => {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    const piece = pieceAt(pattern, index, toSource);
    source += piece.source;
    index = piece.next;
  }
  return source;
};

export const compileGlob = (pattern: string): Matcher => {
  const expression = new RegExp(`^${toSource(pattern)}$`, "u");
  return (path) => expression.test(path);
};

/** True when any of the patterns matches. No patterns match nothing. */
export const compileGlobs = (patterns: readonly string[]): Matcher => {
  const matchers = patterns.map(compileGlob);
  return (path) => matchers.some((matches) => matches(path));
};
