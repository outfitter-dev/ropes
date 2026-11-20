import type { EditorSettings } from "./editor.ts";
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
  /**
   * The facts about text files the config states. Absent when the file has
   * no such table, and then Cinch writes them nowhere.
   */
  readonly editor?: EditorSettings;
  readonly exclude: Sourced<readonly string[]>;
  /** The root-relative file the config came from. Null when there is none. */
  readonly file: string | null;
  readonly include: Sourced<readonly string[]>;
  /** In file order. */
  readonly overrides: readonly ConfigOverride[];
  /**
   * What comes before a key of the config inside its file, when its tables
   * are nested there: `cinch.` in the shared file. Absent when they are not.
   */
  readonly prefix?: string;
  /** Root-relative folders of the repository's own rules. */
  readonly rulesLocal?: Sourced<readonly string[]>;
  /** Shipped rule packs and rules, by name, that are not run. */
  readonly rulesOff?: Sourced<readonly string[]>;
  /** Shipped rule packs, by name, that are run. */
  readonly rulesPacks?: Sourced<readonly string[]>;
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
