/**
 * Provisional and unstable. The plan is what `explain` prints and what `check`
 * and `fix` execute. FIT-6 defines the real shape.
 */
export const SCHEMA_VERSION = 0;

export interface PlanStep {
  /** Adapter id from the registry. */
  readonly adapter: string;
  /** The external tool the adapter drives, and the version it needs. */
  readonly tool: string;
  readonly versionRange: string;
  /** Whether the step may write when run by `fix`. */
  readonly writes: boolean;
}

export interface PlannedPath {
  /** Root-relative path. */
  readonly path: string;
  readonly steps: readonly PlanStep[];
}

export interface Plan {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly root: string;
  readonly paths: readonly PlannedPath[];
}
