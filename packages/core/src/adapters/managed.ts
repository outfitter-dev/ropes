import path from "node:path";

import type { Finding } from "../contracts/finding.ts";
import type {
  Adapter,
  AdapterDescriptor,
  Layer,
  StepOutcome,
} from "./adapter.ts";
import { eachFile } from "./batch.ts";
import type { FileInput } from "./batch.ts";

/** What a kept file should hold, or why Ropes will not decide that itself. */
export type Wanted =
  | {
      readonly ok: true;
      readonly text: string;
      /**
       * What a check says when the file holds something else, in place of
       * the general sentence. For a file a person wrote, it names the edit.
       */
      readonly why?: string;
    }
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * True when Ropes could not work out what the file should hold, which
       * leaves the step incomplete. Otherwise the file itself is the problem.
       */
      readonly unknown?: true;
    };

export interface ManagedFile {
  /** Root-relative. */
  readonly path: string;
  /** See `AdapterDescriptor.layers`. */
  readonly layer?: Layer;
  /** Other files `want` reads. See `AdapterDescriptor.beside`. */
  readonly beside?: readonly string[];
  /**
   * Given what the file holds now, or null when it is missing, and the root
   * it sits in, for a file whose content depends on what is beside it.
   * `migrate` is `StepInput.migrate`.
   */
  readonly want: (
    current: string | null,
    root: string,
    migrate: boolean
  ) => Promise<Wanted>;
}

export interface ManagedOptions {
  readonly id: string;
  /** The policy key that switches these files off when it is `false`. */
  readonly enabledBy: string;
  readonly files: readonly ManagedFile[];
  /** See `AdapterDescriptor.optIn`. */
  readonly optIn?: true;
  /** The name a person uses for this set of files, when it is a preset. */
  readonly preset?: string;
  /** See `Adapter.migrates`. */
  readonly migrates?: Adapter["migrates"];
  /** See `AdapterDescriptor.table`. */
  readonly table?: string;
  /** See `AdapterDescriptor.moves`. */
  readonly moves?: AdapterDescriptor["moves"];
  /** See `Adapter.relocates`. */
  readonly relocates?: Adapter["relocates"];
}

/** The rule every finding about a kept file is reported under. */
export const MANAGED_RULE = "ropes/managed-file";
const TOOL = "ropes";

const read = async (file: string): Promise<string | null> => {
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
};

/**
 * An adapter for files Ropes keeps in a repository, such as a shared config
 * preset. `check` reports a file that is missing or differs from what Ropes
 * ships, and `fix` writes it. The runner calls `fix` only for `doctor --fix`,
 * because these files are the Ropes setup. The engine is Ropes itself, so
 * there is nothing to install.
 */
export const managedAdapter = (options: ManagedOptions): Adapter => {
  const { enabledBy, files, id, migrates, optIn, preset, table } = options;
  const { moves, relocates } = options;
  const layers = Object.fromEntries(
    files.flatMap((file) =>
      file.layer === undefined ? [] : [[file.path, file.layer]]
    )
  );
  const beside = files.flatMap((file) => file.beside ?? []);
  const descriptor: AdapterDescriptor = {
    ...(beside.length === 0 ? {} : { beside }),
    enabledBy,
    extensions: [],
    id,
    ...(moves === undefined ? {} : { moves }),
    ...(Object.keys(layers).length === 0 ? {} : { layers }),
    ...(optIn === undefined ? {} : { optIn }),
    owns: files.map((file) => file.path),
    platforms: ["darwin", "linux", "win32"],
    ...(preset === undefined ? {} : { preset }),
    setup: true,
    ...(table === undefined ? {} : { table }),
    tool: TOOL,
    unit: "file",
    versionRange: "*",
    writes: true,
  };
  const finding = (
    input: FileInput,
    message: string,
    fixable: boolean
  ): Finding => ({
    fixable,
    message,
    path: input.path,
    range: { start: { column: 1, line: 1 } },
    rule: MANAGED_RULE,
    severity: "error",
    source: id,
  });
  const inspect = async (input: FileInput, write: boolean) => {
    const managed = files.find((file) => file.path === input.path);
    if (!managed) {
      return {
        findings: [],
        reason: `${id} does not keep ${input.path}`,
        status: "incomplete",
      } satisfies StepOutcome;
    }
    const target = path.join(input.root, input.path);
    const current = await read(target);
    const wanted = await managed.want(current, input.root, input.migrate);
    if (!wanted.ok && wanted.unknown === true) {
      return {
        findings: [],
        reason: wanted.message,
        status: "incomplete",
      } satisfies StepOutcome;
    }
    if (!wanted.ok) {
      return {
        findings: [finding(input, wanted.message, false)],
        status: "findings",
      } satisfies StepOutcome;
    }
    if (wanted.text === current) {
      return { findings: [], status: "passed" } satisfies StepOutcome;
    }
    if (write) {
      await Bun.write(target, wanted.text);
      return { findings: [], status: "fixed" } satisfies StepOutcome;
    }
    const problem =
      current === null ? "is missing" : "differs from what Ropes keeps here";
    return {
      findings: [
        finding(
          input,
          wanted.why ?? `This file ${problem}. Run \`rope doctor --fix\`.`,
          true
        ),
      ],
      status: "findings",
    } satisfies StepOutcome;
  };
  return {
    check: (input) => eachFile(input, (file) => inspect(file, false)),
    descriptor,
    fix: (input) => eachFile(input, (file) => inspect(file, true)),
    ...(migrates === undefined ? {} : { migrates }),
    probe: () => Promise.resolve({ available: true }),
    ...(relocates === undefined ? {} : { relocates }),
  };
};
