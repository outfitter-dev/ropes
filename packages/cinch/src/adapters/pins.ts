import path from "node:path";

/** The file that pins tool versions. See docs/tool-versions.md. */
export const PINS_FILE = "mise.toml";

/** Tool name to the exact version the repository pins. */
export type Pins = Readonly<Record<string, string>>;

export type PinsResult =
  | { readonly ok: true; readonly pins: Pins }
  | { readonly ok: false; readonly message: string };

const EXACT = /^\d+\.\d+\.\d+$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** mise accepts `tool = "1.2.3"` and `tool = { version = "1.2.3" }`. */
const versionOf = (entry: unknown): unknown =>
  isRecord(entry) ? entry.version : entry;

/**
 * The exact pins in a parsed `mise.toml`. An entry that is not a three-part
 * version, such as `latest` or `1`, does not count as a pin.
 */
export const pinsFrom = (table: unknown): Pins => {
  const tools = isRecord(table) ? table.tools : undefined;
  const pins: Record<string, string> = {};
  for (const [name, entry] of Object.entries(isRecord(tools) ? tools : {})) {
    const version = versionOf(entry);
    if (typeof version === "string" && EXACT.test(version)) {
      pins[name] = version;
    }
  }
  return pins;
};

/**
 * Reads the pins under `root`. The file is plain TOML, so this does not need
 * mise installed. No file means no pins. A file that cannot be read or parsed
 * comes back as an error, never as "no pins".
 */
export const readPins = async (root: string): Promise<PinsResult> => {
  try {
    const file = Bun.file(path.join(root, PINS_FILE));
    if (!(await file.exists())) {
      return { ok: true, pins: {} };
    }
    return { ok: true, pins: pinsFrom(Bun.TOML.parse(await file.text())) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { message: `${PINS_FILE} could not be read: ${detail}`, ok: false };
  }
};
