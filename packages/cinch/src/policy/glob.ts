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

const SPECIAL = /[.+^$()|\\]/gu;

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

const brackets = (pattern: string, index: number): Piece => {
  const end = closing(pattern, index + 1, "]");
  if (end === -1) {
    return { next: index + 1, source: "\\[" };
  }
  const body = pattern.slice(index + 1, end);
  const negated = body.startsWith("!") || body.startsWith("^");
  const members = escape(negated ? body.slice(1) : body).replaceAll("]", "\\]");
  return {
    next: end + 1,
    source: negated ? `[^/${members}]` : `(?!/)[${members}]`,
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
