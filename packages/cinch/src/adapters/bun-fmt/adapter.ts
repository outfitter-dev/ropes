import type {
  Adapter,
  AdapterDescriptor,
  FileOutcome,
  StepInput,
} from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { markFixed } from "../changed.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { readFacts } from "./facts.ts";
import { checkBatch, fixBatch } from "./run.ts";

const ID = "bun-fmt";
const TOOL = "bun";

/**
 * What applies when the repository does not pin Bun. The output mapping was
 * checked against 1.4.4.
 */
export const SUPPORTED_RANGE = ">=1.4.4 <2.0.0";

/** The kinds of file the formatter takes, as 1.4.4 lists them. */
const EXTENSIONS = [
  ".ts .tsx .mts .cts .js .jsx .mjs .cjs",
  ".json .jsonc .json5 .yaml .yml .toml",
  ".md .mdx .css .scss .less .html .vue .graphql .gql .hbs",
].flatMap((kinds) => kinds.split(" "));

export interface BunFmtOptions {
  /** Compatibility config names owned by the corresponding registered adapter. */
  readonly compatibilityConfigs?: readonly string[];
  /** The exact version the repository pins, when it pins one. */
  readonly version?: string | undefined;
  /** The executable to look up on `PATH`. */
  readonly command?: string;
}

/**
 * Formatting through `bun fmt`, which reads the repository's formatter
 * config from the root. It runs once for the files of a batch. In `fix` it
 * writes, and it is registered last, so it formats what the other engines
 * left. Cinch does not install Bun: the binary must be on `PATH` at the
 * pinned version, or its steps are incomplete. It is off until the Cinch
 * config asks for it.
 */
export const bunFmtAdapter = (options: BunFmtOptions = {}): Adapter => {
  const command = options.command ?? TOOL;
  const descriptor: AdapterDescriptor = {
    ...heldTo(options.version, SUPPORTED_RANGE),
    enabledBy: "format.enabled",
    extensions: EXTENSIONS,
    formats: true,
    id: ID,
    optIn: true,
    platforms: ["darwin", "linux", "win32"],
    reports: ["line_width"],
    tool: TOOL,
    unit: "file",
    writes: true,
  };
  const withBinary = (
    input: StepInput,
    body: (binary: string) => Promise<FileOutcome[]>
  ): Promise<FileOutcome[]> => {
    const binary = Bun.which(command);
    return binary === null
      ? Promise.resolve(allIncomplete(input, `${command} is not on PATH`))
      : body(binary);
  };
  return {
    check: (input) => withBinary(input, (binary) => checkBatch(binary, input)),
    descriptor,
    facts: (root, paths) =>
      readFacts(command, root, paths, options.compatibilityConfigs),
    fix: (input) =>
      withBinary(input, (binary) =>
        markFixed(input, () => fixBatch(binary, input))
      ),
    probe: () => probeOnPath(command),
  };
};
