import type { PolicyValue, Provenance } from "./plan.ts";

/**
 * Provisional and unstable. The pilot config format's version marker. A file
 * must state it, and a loader that meets another value must stop.
 */
export const PILOT_VERSION = 0;

/** A value together with where it came from. */
export interface Sourced<T> {
  readonly source: Provenance;
  readonly value: T;
}

/** Settings that replace the base ones for the paths the globs match. */
export interface ConfigOverride {
  /** Root-relative globs. */
  readonly paths: readonly string[];
  readonly settings: readonly PolicyValue[];
}

/** Settings for one tool, in that tool's own words. Cinch does not read them. */
export type ToolTable = Readonly<Record<string, unknown>>;

/** The tables under `tools`, by the name of the tool each one is for. */
export type ToolTables = Readonly<Record<string, ToolTable>>;

/** What the loader hands to the resolver. Later overrides win. */
export interface CinchConfig {
  readonly exclude: Sourced<readonly string[]>;
  /** The root-relative file the config came from. Null when there is none. */
  readonly file: string | null;
  readonly include: Sourced<readonly string[]>;
  /** In file order. */
  readonly overrides: readonly ConfigOverride[];
  readonly settings: readonly PolicyValue[];
  /**
   * What the file states for each tool. An adapter copies its table into the
   * config Cinch generates for that tool.
   */
  readonly tools: ToolTables;
}

export type ConfigError =
  /** The file exists but could not be read. */
  | {
      readonly kind: "unreadable";
      readonly file: string;
      readonly message: string;
    }
  | {
      readonly kind: "malformed";
      readonly file: string;
      readonly message: string;
    }
  | { readonly kind: "missing-version"; readonly file: string }
  | {
      readonly kind: "unknown-version";
      readonly file: string;
      readonly found: unknown;
    }
  | {
      readonly kind: "invalid";
      readonly file: string;
      readonly issues: readonly string[];
    }
  /** Two files both configure Cinch. Neither is read. */
  | { readonly kind: "conflict"; readonly files: readonly string[] };

export type ConfigResult =
  | { readonly ok: true; readonly value: CinchConfig }
  | { readonly ok: false; readonly error: ConfigError };

const DEFAULT: Provenance = { kind: "default" };

/** What applies when a repository has no config file. */
export const DEFAULT_CONFIG: CinchConfig = {
  exclude: { source: DEFAULT, value: [] },
  file: null,
  include: { source: DEFAULT, value: ["**/*.md", "**/*.toml"] },
  overrides: [],
  settings: [
    { key: "markdown.enabled", source: DEFAULT, value: true },
    { key: "toml.enabled", source: DEFAULT, value: true },
  ],
  tools: {},
};
