import type { Finding } from "../contracts/finding.ts";
import type { StepStatus } from "../contracts/result.ts";

export type Platform = "darwin" | "linux" | "win32";

/**
 * What one step works on. Only `file` steps are planned today. `package` and
 * `workspace` are named now so an engine that cannot work file by file does
 * not have to pretend it can. The resolver gives such an adapter no steps.
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

export interface StepInput {
  readonly root: string;
  readonly path: string;
}

/** The files a config that an adapter replaces chose to check. */
export interface Inherited {
  /** The root-relative file the choices came from. */
  readonly from: string;
  /** Root-relative globs, in the form the Cinch config reads. */
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** One line for each choice that could not be carried over. */
  readonly notes: readonly string[];
}

/**
 * The one seam engines plug into. The runner knows only this interface, and
 * nothing outside an adapter's own folder and the registry names an engine.
 */
export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  /** Reports whether the tool is installed, and at which version. */
  readonly probe: () => Promise<ProbeResult>;
  readonly check: (input: StepInput) => Promise<StepOutcome>;
  readonly fix: (input: StepInput) => Promise<StepOutcome>;
  /**
   * The file choices in a config this adapter takes over from, for a Cinch
   * config that is about to be written. Null when there are none.
   */
  readonly inherits?: (root: string) => Promise<Inherited | null>;
}
