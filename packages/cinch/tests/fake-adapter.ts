import type {
  Adapter,
  AdapterDescriptor,
  ProbeResult,
  StepInput,
  StepOutcome,
} from "../src/adapters/adapter.ts";
import { eachFile } from "../src/adapters/batch.ts";
import type { FileInput } from "../src/adapters/batch.ts";

export const PASSED: StepOutcome = { findings: [], status: "passed" };
export const FIXED: StepOutcome = { findings: [], status: "fixed" };
export const FINDINGS: StepOutcome = {
  findings: [
    {
      fixable: true,
      message: "bad",
      path: "a.md",
      range: { start: { column: 1, line: 1 } },
      rule: "fake/rule",
      severity: "error",
      source: "fake",
    },
  ],
  status: "findings",
};

export const describeFake = (
  overrides: Partial<AdapterDescriptor> = {}
): AdapterDescriptor => ({
  enabledBy: "markdown.enabled",
  extensions: [".md"],
  id: "fake",
  platforms: ["darwin", "linux", "win32"],
  tool: "fake-tool",
  unit: "file",
  versionRange: "*",
  writes: true,
  ...overrides,
});

export interface FakeOptions {
  readonly descriptor?: Partial<AdapterDescriptor>;
  readonly probe?: () => Promise<ProbeResult>;
  /** Asked once for each file of a batch. */
  readonly check?: (file: FileInput) => Promise<StepOutcome>;
  readonly fix?: (file: FileInput) => Promise<StepOutcome>;
}

export interface FakeAdapter extends Adapter {
  /** Every call the runner made, in order. */
  readonly calls: string[];
  /** The files of each `check` or `fix` call, in order. */
  readonly batches: StepInput[];
}

/** An in-memory adapter. It records what the runner asked of it. */
export const fakeAdapter = (options: FakeOptions = {}): FakeAdapter => {
  const calls: string[] = [];
  const record =
    <A extends unknown[], T>(name: string, run: (...args: A) => Promise<T>) =>
    (...args: A) => {
      calls.push(name);
      return run(...args);
    };
  const batches: StepInput[] = [];
  const each =
    (one: (file: FileInput) => Promise<StepOutcome>) => (input: StepInput) => {
      batches.push(input);
      return eachFile(input, one);
    };
  return {
    batches,
    calls,
    check: record(
      "check",
      each(options.check ?? (() => Promise.resolve(PASSED)))
    ),
    descriptor: describeFake(options.descriptor),
    fix: record("fix", each(options.fix ?? (() => Promise.resolve(FIXED)))),
    probe: record(
      "probe",
      options.probe ?? (() => Promise.resolve({ available: true }))
    ),
  };
};
