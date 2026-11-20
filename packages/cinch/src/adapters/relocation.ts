/** The Cinch config of a repository, as it stands on disk. */
export interface ConfigText {
  /** Root-relative. */
  readonly file: string;
  /** See `CinchConfig.prefix`. Empty when the tables are not nested. */
  readonly prefix: string;
  readonly text: string;
}

export type Relocation =
  | {
      readonly ok: true;
      /** Each file with all of its new text. Empty when nothing moves. */
      readonly files: readonly {
        readonly path: string;
        readonly text: string;
      }[];
      /** What a person should know about the move, one line each. */
      readonly notes: readonly string[];
    }
  /** Nothing can move until a person has dealt with each reason. */
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Moves a tool's settings between the config a person writes for the tool
 * and the tool's table in the Cinch config. Neither direction writes: each
 * returns the files as they should be, and the caller shows or writes them.
 * The tool must resolve the same settings before and after.
 */
export interface Relocates {
  /** Out of the tool's own config, into the Cinch config. */
  readonly absorb: (root: string, config: ConfigText) => Promise<Relocation>;
  /** Out of the Cinch config, into a config the repository owns. */
  readonly eject: (root: string, config: ConfigText) => Promise<Relocation>;
}
