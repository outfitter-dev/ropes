import type { ConfigError } from "./config.ts";

/** How the version-control boundary was recognised. */
export type VcsKind =
  /** A `.git` directory. */
  | "git"
  /** A `.git` file: a linked worktree, or a submodule. */
  | "git-linked"
  /** A `.jj` directory: a jj workspace, colocated with git or not. */
  | "jj";

/** Where Cinch anchors its config and its root-relative paths, and why. */
export interface RepoRoot {
  /** The config file that set the root, root-relative. Null when none did. */
  readonly configFile: string | null;
  /** Absolute path that config and plan paths are relative to. */
  readonly root: string;
  /** The directory discovery started from, relative to `root`. */
  readonly startedIn: string;
  readonly vcs: VcsKind;
  /** Absolute path of the version-control boundary. At or above `root`. */
  readonly vcsRoot: string;
}

export type RootError =
  | { readonly kind: "configuration"; readonly error: ConfigError }
  /** No version-control boundary at or above the start directory. */
  | { readonly kind: "no-repo"; readonly from: string }
  /** A selected path lies outside the root. */
  | {
      readonly kind: "outside-root";
      readonly path: string;
      readonly root: string;
    };

export type RootResult =
  | { readonly ok: true; readonly value: RepoRoot }
  | { readonly ok: false; readonly error: RootError };

export type PathResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: RootError };
