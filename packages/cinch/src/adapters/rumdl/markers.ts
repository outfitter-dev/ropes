import type { Finding } from "../../contracts/finding.ts";
import { linesOf } from "./blocks.ts";
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

const COMMENT = /^<!--\s*(?<body>cinch-\S*(?:\s+\S+)*?)\s*-->$/u;
const WORDS = MARKER.slice(4, -3).trim();

interface Marker {
  /** The one-based line the comment is on. */
  readonly line: number;
  readonly body: string;
  /**
   * The one-based line of the fence the comment is above, when the next line
   * that is not blank opens one. A formatter puts a blank line between a
   * comment and a fence, so one is allowed.
   */
  readonly fence: number | null;
}

/**
 * The Cinch comments of a Markdown file. A comment inside a fenced block is
 * that block's text, so a document can show the marker without using it.
 */
const markersIn = (text: string): Marker[] => {
  const lines = linesOf(text);
  return lines.flatMap((line, index): Marker[] => {
    const body =
      line.kind === "text" ? COMMENT.exec(line.text)?.groups?.body : undefined;
    if (body === undefined) {
      return [];
    }
    const next = lines.findIndex(
      (later, at) => at > index && later.text !== ""
    );
    return [
      {
        body: body.replaceAll(/\s+/gu, " "),
        fence: lines[next]?.kind === "open" ? next + 1 : null,
        line: index + 1,
      },
    ];
  });
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
    if (marker.fence !== null && fragments.has(marker.fence)) {
      excused.add(marker.fence);
      return [];
    }
    return [
      own(
        marker.line,
        UNUSED_RULE,
        marker.fence === null
          ? "This comment does nothing: it is not right above a fenced code block. Move or remove it."
          : "This comment does nothing: the code block below it parses. Remove it."
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
