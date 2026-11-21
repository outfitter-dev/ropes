import type { EditorFacts } from "../../contracts/editor.ts";

type Charset = NonNullable<EditorFacts["charset"]>;
interface Decoded {
  readonly text?: string;
  readonly problem?: string;
  readonly incomplete?: string;
}

const marker = (
  bytes: Uint8Array
): { charset: Charset; length: number } | undefined => {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { charset: "utf-8-bom", length: 3 };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { charset: "utf-16le", length: 2 };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { charset: "utf-16be", length: 2 };
  }
  return undefined;
};

/** Decode declared encodings strictly. Without a declaration, use a BOM or UTF-8. */
export const decode = (bytes: Uint8Array, wanted?: Charset): Decoded => {
  if (bytes.length === 0) {
    return { text: "" };
  }
  const bom = marker(bytes);
  const charset = bom?.charset ?? wanted ?? "utf-8";
  const content = bytes.subarray(bom?.length ?? 0);
  const markerProblem =
    bom === undefined
      ? "add the byte-order marker required by utf-8-bom"
      : `the file has a ${bom.charset} marker but charset is ${wanted}`;
  const problem =
    wanted !== undefined &&
    ((bom !== undefined && bom.charset !== wanted) ||
      (wanted === "utf-8-bom" && bom === undefined))
      ? markerProblem
      : undefined;
  try {
    // WHATWG latin1 aliases Windows-1252, so decode the declared byte values directly.
    const text =
      charset === "latin1"
        ? Array.from(content, (byte) => String.fromCodePoint(byte)).join("")
        : new TextDecoder(charset === "utf-8-bom" ? "utf-8" : charset, {
            fatal: true,
          }).decode(content);
    // eslint-disable-next-line no-control-regex -- these controls make text conventions unprovable
    if (/[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/u.test(text)) {
      return {
        incomplete: "the selected file contains binary control characters",
      };
    }
    return { ...(problem === undefined ? {} : { problem }), text };
  } catch {
    return wanted === undefined
      ? {
          incomplete:
            "the selected file has no declared charset and is not valid UTF-8 text",
        }
      : { problem: `the file is not valid ${charset} text` };
  }
};
