import type { Finding } from "../contracts/finding.ts";
import type { StepStatus } from "../contracts/result.ts";

export type Platform = "darwin" | "linux" | "win32";

/**
 * What an engine needs to see to judge one file. A `file` adapter can answer
 * for any subset of a package, so it is handed only the files selected.
 * `package` and `workspace` are named now so an engine that needs more does
 * not have to pretend otherwise. The resolver gives such an adapter no steps
 * yet.
 */
export type Unit = "file" | "package" | "workspace";

/** The data the resolver needs about an adapter. It carries no behavior. */
export interface AdapterDescriptor {
  readonly id: string;
  readonly tool: string;
  /** A semver range the installed tool must satisfy. `*` accepts any. */
  readonly versionRange: string;
  readonly writes: boolean;
  readonly unit: Unit;
  /** Where the tool can run. Elsewhere its steps are incomplete. */
  readonly platforms: readonly Platform[];
  /** File extensions, with the dot, that this adapter handles. */
  readonly extensions: readonly string[];
  /**
   * The policy key that switches this adapter. A path whose resolved policy
   * sets the key to `false` gets no step from it.
   */
  readonly enabledBy: string;
  /**
   * Root-relative files this adapter keeps, whatever their extension and
   * whatever `include` says. They are planned even before they exist, so a
   * check can report a missing one and a fix can write it.
   */
  readonly owns?: readonly string[];
  /**
   * The name a person uses for the shared config this adapter keeps in its
   * `owns` files, such as `markdown`. Adapters that keep none leave it out.
   */
  readonly preset?: string;
}

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
 * What one step works on: the selected files of one package, so an engine
 * starts once for all of them.
 */
export interface StepInput {
  readonly root: string;
  /** The root-relative package directory. `.` is the workspace itself. */
  readonly package: string;
  /** Root-relative files, all in that package. Never empty. */
  readonly paths: readonly string[];
}

/** What a step found out about one of the files it was handed. */
export interface FileOutcome extends StepOutcome {
  readonly path: string;
}

/** The files a config that an adapter replaces chose to check. */
export interface Inherited {
  /** The root-relative file the choices came from. */
  readonly from: string;
  /** Root-relative globs, in the form the Cinch config reads. */
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** The file endings the replaced config covered, such as `.md`. */
  readonly kinds: readonly string[];
  /** One line for each choice that could not be carried over. */
  readonly notes: readonly string[];
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
  /** Other traces of the old tool, which Cinch reports and does not remove. */
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
   * The file choices the source made, for a Cinch config that is about to be
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
  /** Reports whether the tool is installed, and at which version. */
  readonly probe: () => Promise<ProbeResult>;
  /**
   * One outcome for each file handed in. A file left without one is
   * incomplete: the runner never counts silence as a pass.
   */
  readonly check: (input: StepInput) => Promise<readonly FileOutcome[]>;
  readonly fix: (input: StepInput) => Promise<readonly FileOutcome[]>;
  /**
   * The configs this adapter can take over from. `init` asks each one what
   * it found and never learns which tool it reads.
   */
  readonly migrates?: readonly MigrationSource[];
}
