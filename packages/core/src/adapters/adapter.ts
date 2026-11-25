import type { FactReport } from "../contracts/facts.ts";
import type { Finding } from "../contracts/finding.ts";
import type { StepStatus } from "../contracts/result.ts";
import type { RuleDefinitions } from "../contracts/rule-explanation.ts";
import type { PackageTarget } from "../contracts/targets.ts";
import type { CheckDescriptionResult } from "../contracts/trace.ts";
import type { AdapterDescriptor } from "./descriptor.ts";
import type { Settled } from "./found.ts";
import type { Relocates } from "./relocation.ts";

export type { AdapterDescriptor, Platform, Unit } from "./descriptor.ts";
export type { Layer } from "../contracts/plan.ts";

export interface ProbeResult {
  readonly available: boolean;
  /** The installed version as plain semver, with no tool name or prefix. */
  readonly version?: string;
  readonly reason?: string;
}

export interface StepOutcome {
  readonly status: StepStatus;
  readonly findings: readonly Finding[];
  readonly reason?: string;
}

/**
 * What one start of an engine must answer for. For package and workspace
 * adapters, the engine may inspect its project while reporting only on the selected paths.
 */
export interface StepInput {
  readonly root: string;
  /** Original checkout when a writing batch runs against a preview copy. */
  readonly sourceRoot?: string;
  /** The root-relative package directory. `.` is the workspace itself. */
  readonly package: string;
  /** Root-relative files in this batch, and the only files it may edit. */
  readonly paths: readonly string[];
  /**
   * True only while `init` takes a repository over from an older setup. It
   * is the one time an adapter may carry an old config's settings into a
   * file a person wrote. Every other run leaves such a file's own content
   * as it is.
   */
  readonly migrate?: boolean;
  /**
   * The ids of the rules that are on, for an adapter that ships rule packs.
   * It runs these and no others.
   */
  readonly rules?: readonly string[];
  /** The plan's declared support target, independent of tool readiness. */
  readonly target?: PackageTarget;
}

/** What a step found out about one of the files it was handed. */
export interface FileOutcome extends StepOutcome {
  readonly path: string;
}

/** An installed input copied into a preview without a writable source link. */
export interface PreviewInput {
  /** Preserve directory existence without replacing copied repository files. */
  readonly directory?: true;
  readonly path: string;
  readonly source: string;
}

/** The files a config that an adapter replaces chose to check. */
export interface Inherited {
  /** The root-relative file the choices came from. */
  readonly from: string;
  /** Root-relative globs, in the form the Ropes config reads. */
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** The file endings the replaced config covered, such as `.md`. */
  readonly kinds: readonly string[];
  /** One line for each choice that could not be carried over. */
  readonly notes: readonly string[];
  /**
   * Whole lines for the Ropes config that state what the replaced config
   * stated, beyond its file choices. They go in as they are, after the rest.
   */
  readonly tables?: readonly string[];
  /** Root-relative files Ropes keeps once `tables` are in its config. */
  readonly keeps?: readonly string[];
}

/** What is left of a tool an adapter takes over from. */
export interface Retired {
  /** Root-relative config files nothing reads once the adapter's are kept. */
  readonly files: readonly string[];
  /** Why they should stay for now, one line each. Empty when they can go. */
  readonly keep: readonly string[];
  /**
   * Root-relative files of the adapter's own that hold what was carried
   * over. The old files stay unless each of them is part of the run.
   */
  readonly needs: readonly string[];
  /** Other traces of the old tool, which Ropes reports and does not remove. */
  readonly leftovers: readonly string[];
}

/**
 * One config an adapter can take over from: the tool it replaces, or a
 * hand-written config of its own tool. A source reads, and never writes. The
 * adapter's own steps do the writing.
 */
export interface MigrationSource {
  /** A name for the source that is stable across releases. */
  readonly id: string;
  /**
   * The file choices the source made, for a Ropes config that is about to be
   * written. Null when it made none.
   */
  readonly inherits?: (root: string) => Promise<Inherited | null>;
  /**
   * What the source holds: its files, what cannot be carried over and why,
   * and whether the files can go once the adapter's own are written. It is
   * judged before the first write: `init` asks, writes, and then removes.
   * Null when the repository has none of it.
   */
  readonly retires?: (root: string) => Promise<Retired | null>;
}

/**
 * The one seam engines plug into. The runner knows only this interface, and
 * nothing outside an adapter's own folder and the registry names an engine.
 */
export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  /**
   * Reports whether the tool is installed, and at which version. `root` is
   * the repository a run is for. A tool the repository installs is looked
   * for there, so the probe answers for the executable the run then starts.
   */
  readonly probe: (root?: string) => Promise<ProbeResult>;
  /**
   * One outcome for each file handed in. A file left without one is
   * incomplete: the runner never counts silence as a pass.
   */
  readonly check: (input: StepInput) => Promise<readonly FileOutcome[]>;
  readonly fix: (input: StepInput) => Promise<readonly FileOutcome[]>;
  /** Additional installed inputs needed by this exact batch in a dry run. */
  readonly previewInputs?: (
    input: StepInput
  ) => Promise<readonly PreviewInput[]>;
  /** Describe initial check invocations without running or probing an engine. */
  readonly describeRules?: (root: string) => Promise<RuleDefinitions>;
  readonly describeCheck?: (
    input: StepInput
  ) => Promise<CheckDescriptionResult>;
  /**
   * The configs this adapter can take over from. `init` asks each one what
   * it found and never learns which tool it reads.
   */
  readonly migrates?: readonly MigrationSource[];
  /**
   * What the tool resolves for the facts the descriptor says it reports,
   * each with the file that sets it. It reads, and never writes.
   */
  readonly facts?: (
    root: string,
    paths?: readonly string[]
  ) => Promise<FactReport>;
  /**
   * Moves the tool's settings between a config a person wrote for it and
   * its table in the Ropes config. An adapter with no such table has none.
   */
  readonly relocates?: Relocates;
  /**
   * The adapter as it stands once it has read what the repository says to
   * its engine in the engine's own files. It reads, and never writes.
   */
  readonly settled?: (root: string) => Promise<Settled>;
}
