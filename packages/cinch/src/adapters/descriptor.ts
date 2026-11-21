import type { Layer } from "../contracts/plan.ts";
import type { RulePack } from "../contracts/rules.ts";
import type { TargetCondition } from "../contracts/targets.ts";
import type { FoundRules } from "./found.ts";

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
  /**
   * The range the adapter was tested on, present when `versionRange` is a
   * pin. Outside a strict run, a tool newer than the pin but inside this
   * range still runs, with a notice.
   */
  readonly tested?: string;
  readonly writes: boolean;
  /** Content formatting ownership, including its read-only check operation. */
  readonly formats?: true;
  /** Check text conventions only when this path has no selected formatter. */
  readonly fallbackFormat?: true;
  readonly unit: Unit;
  /** Where the tool can run. Elsewhere its steps are incomplete. */
  readonly platforms: readonly Platform[];
  /** File extensions, with the dot. A star accepts every selected path. */
  readonly extensions: readonly string[];
  /**
   * The policy key that switches this adapter. A path whose resolved policy
   * sets the key to `false` gets no step from it.
   */
  readonly enabledBy: string;
  /**
   * True when the adapter is off until policy sets `enabledBy` to `true`.
   * Without it the adapter is on until policy sets the key to `false`.
   */
  readonly optIn?: true;
  /**
   * Root-relative files this adapter keeps, whatever their extension and
   * whatever `include` says. They are planned even before they exist, so a
   * check can report a missing one and a fix can write it.
   */
  readonly owns?: readonly string[];
  /**
   * True when what this adapter writes is the Cinch setup, not the
   * repository's own content. `fix` then only checks its files, and
   * `doctor --fix` is the one verb that writes them.
   */
  readonly setup?: true;
  /**
   * The name a person uses for the shared config this adapter keeps in its
   * `owns` files, such as `markdown`. Adapters that keep none leave it out.
   */
  readonly preset?: string;
  /**
   * For an adapter that is no preset and still has settings a person can
   * move with `preset adopt` and `preset eject`: the name they use, and the
   * files the move is about, kept by the adapter or not.
   */
  readonly moves?: {
    readonly name: string;
    readonly files: readonly string[];
  };
  /**
   * The table under `tools` in the Cinch config that this adapter copies
   * into a file it keeps. Adapters that generate no config leave it out.
   */
  readonly table?: string;
  /**
   * The part each kept file plays in the chain a tool reads its config
   * through, by root-relative path. `explain` names it.
   */
  readonly layers?: Readonly<Record<string, Layer>>;
  /** Root-relative files it reads when they are there and never writes. */
  readonly beside?: readonly string[];
  /**
   * The shared facts this adapter can report its tool's value for, by the
   * names the `[editor]` table uses. An empty list says the tool has such
   * settings and the adapter cannot report them. Leave it out for a tool
   * that has none.
   */
  readonly reports?: readonly string[];
  /**
   * The rule packs this adapter ships. The resolver decides which of their
   * rules are on, and an adapter with none on gets no step.
   */
  readonly packs?: readonly RulePack[];
  /** File scopes from the shipped rules, keyed by rule id. */
  /** Digests of embedded rules for explicit immutable comparison policies. */
  readonly ruleDigests?: Readonly<Record<string, string>>;
  /** Explicitly tested occurrence identities for incremental cleanup. */
  readonly ruleIdentities?: Readonly<Record<string, "single-json-document">>;
  readonly ruleScopes?: Readonly<
    Record<
      string,
      {
        readonly files?: readonly string[] | undefined;
        readonly ignores?: readonly string[] | undefined;
      }
    >
  >;
  /** A declared package support target that makes these checks applicable. */
  readonly target?: TargetCondition;
  /**
   * Root-relative folders of rules the repository wrote, which this adapter
   * runs beside its own. With one, it has a step even when no pack is on.
   */
  readonly localRules?: readonly string[];
  /** More such folders, which the engine's own project config names. */
  readonly foundRules?: FoundRules;
}
