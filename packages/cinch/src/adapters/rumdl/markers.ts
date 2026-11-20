import type { Finding } from "../../contracts/finding.ts";
import { PARSE_RULE } from "./fences.ts";

/**
 * The comment that says a fenced block is a fragment on purpose. The engine
 * has no way to leave one block unformatted, so this one is Cinch's. It is
 * written the way the engine writes its own, to read the same and to be
 * swapped for a native form when there is one.
 */
export const MARKER = `<!-- cinch-disable-next-line ${PARSE_RULE} -->`;

export const UNUSED_RULE = "cinch/unused-disable";
export const UNKNOWN_RULE = "cinch/unknown-disable";

const COMMENT = /^\s*<!--\s*(?<body>cinch-\S*(?:\s+\S+)*?)\s*-->\s*$/u;
const FENCE = /^\s*(?:>\s?)*\s*(?<ticks>`{3,}|~{3,})(?<info>.*)$/u;
const WORDS = MARKER.slice(4, -3).trim();

interface Marker {
  /** The one-based line the comment is on. */
  readonly line: number;
  readonly body: string;
  /** Whether a fenced block opens on the next line. */
  readonly aboveFence: boolean;
}

/**
 * The Cinch comments of a Markdown file. A comment inside a fenced block is
 * that block's text, so a document can show the marker without using it.
 */
const closes = (
  open: string,
  fence: Record<string, string> | undefined
): boolean =>
  fence !== undefined &&
  fence.ticks?.startsWith(open) === true &&
  fence.info?.trim() === "";

const markersIn = (text: string): Marker[] => {
  const lines = text.split("\n");
  const found: Marker[] = [];
  let open: string | null = null;
  for (const [index, line] of lines.entries()) {
    const fence = FENCE.exec(line)?.groups;
    if (open !== null) {
      open = closes(open, fence) ? null : open;
    } else if (fence === undefined) {
      const body = COMMENT.exec(line)?.groups?.body;
      if (body !== undefined) {
        found.push({
          aboveFence: FENCE.test(lines[index + 1] ?? ""),
          body: body.replaceAll(/\s+/gu, " "),
          line: index + 1,
        });
      }
    } else {
      open = fence.ticks ?? null;
    }
  }
  return found;
};

/**
 * The findings of one file once its markers are read. A marked block that
 * does not parse is no finding. A marker that is misspelled, or that sits
 * above nothing it could excuse, is one, on its own line.
 */
export const withMarkers = (
  text: string,
  findings: readonly Finding[],
  context: { readonly path: string; readonly source: string }
): Finding[] => {
  const markers = markersIn(text);
  if (markers.length === 0) {
    return [...findings];
  }
  const own = (line: number, rule: string, message: string): Finding => ({
    fixable: false,
    message,
    path: context.path,
    range: { start: { column: 1, line } },
    rule,
    severity: "error",
    source: context.source,
  });
  const fragments = new Set(
    findings
      .filter((finding) => finding.rule === PARSE_RULE)
      .map((finding) => finding.range.start.line)
  );
  const excused = new Set<number>();
  const added = markers.flatMap((marker): Finding[] => {
    if (marker.body !== WORDS) {
      return [
        own(
          marker.line,
          UNKNOWN_RULE,
          `Cinch does not know the comment \`${marker.body}\`. The one it reads is \`${MARKER}\`.`
        ),
      ];
    }
    if (marker.aboveFence && fragments.has(marker.line + 1)) {
      excused.add(marker.line + 1);
      return [];
    }
    return [
      own(
        marker.line,
        UNUSED_RULE,
        marker.aboveFence
          ? "This comment does nothing: the code block below it parses. Remove it."
          : "This comment does nothing: it is not on the line above a fenced code block. Move or remove it."
      ),
    ];
  });
  return [
    ...findings.filter(
      (finding) =>
        finding.rule !== PARSE_RULE || !excused.has(finding.range.start.line)
    ),
    ...added,
  ].toSorted((a, b) => a.range.start.line - b.range.start.line);
};
