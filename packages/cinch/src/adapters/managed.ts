import path from "node:path";

import type { Finding } from "../contracts/finding.ts";
import type {
  Adapter,
  AdapterDescriptor,
  StepInput,
  StepOutcome,
} from "./adapter.ts";

/** What a kept file should hold, or why Cinch will not decide that itself. */
export type Wanted =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly message: string;
      /**
       * True when Cinch could not work out what the file should hold, which
       * leaves the step incomplete. Otherwise the file itself is the problem.
       */
      readonly unknown?: true;
    };

export interface ManagedFile {
  /** Root-relative. */
  readonly path: string;
  /**
   * Given what the file holds now, or null when it is missing, and the root
   * it sits in, for a file whose content depends on what is beside it.
   */
  readonly want: (current: string | null, root: string) => Promise<Wanted>;
}

export interface ManagedOptions {
  readonly id: string;
  /** The policy key that switches these files off when it is `false`. */
  readonly enabledBy: string;
  readonly files: readonly ManagedFile[];
  /** The name a person uses for this set of files, when it is a preset. */
  readonly preset?: string;
}

/** The rule every finding about a kept file is reported under. */
export const MANAGED_RULE = "cinch/managed-file";
const TOOL = "cinch";

const read = async (file: string): Promise<string | null> => {
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
};

/**
 * An adapter for files Cinch keeps in a repository, such as a shared config
 * preset. `check` reports a file that is missing or differs from what Cinch
 * ships, and `fix` writes it. The engine is Cinch itself, so there is nothing
 * to install.
 */
export const managedAdapter = (options: ManagedOptions): Adapter => {
  const { enabledBy, files, id, preset } = options;
  const descriptor: AdapterDescriptor = {
    enabledBy,
    extensions: [],
    id,
    owns: files.map((file) => file.path),
    platforms: ["darwin", "linux", "win32"],
    ...(preset === undefined ? {} : { preset }),
    tool: TOOL,
    unit: "file",
    versionRange: "*",
    writes: true,
  };
  const finding = (
    input: StepInput,
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
  const inspect = async (input: StepInput, write: boolean) => {
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
    const wanted = await managed.want(current, input.root);
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
      current === null ? "is missing" : `differs from what ${TOOL} keeps here`;
    return {
      findings: [
        finding(input, `This file ${problem}. Run \`${TOOL} fix\`.`, true),
      ],
      status: "findings",
    } satisfies StepOutcome;
  };
  return {
    check: (input): Promise<StepOutcome> => inspect(input, false),
    descriptor,
    fix: (input): Promise<StepOutcome> => inspect(input, true),
    probe: () => Promise.resolve({ available: true }),
  };
};
