import path from "node:path";

import { ROPES_FILE, SHARED_FILE, STANDALONE_FILE } from "../config/load.ts";
import type { CinchConfig } from "../contracts/config.ts";
import {
  CINCH_MANAGED_DIR,
  ROPES_MANAGED_DIR,
} from "../contracts/managed-config.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import type { Plan } from "../contracts/plan.ts";
import { compileGlobs } from "../policy/glob.ts";
import type { Operation } from "./command.ts";
import type { CommandDeps } from "./prepare.ts";
import { prepareSetup } from "./setup.ts";

interface ManagedMove {
  readonly from: string;
  readonly to: string;
}

interface RootReference extends ManagedMove {
  readonly path: string;
}

export interface MigrationPreview {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly source: { readonly path: string; readonly table?: string };
  readonly target: { readonly path: string; readonly text: string };
  readonly managedFiles: readonly ManagedMove[];
  readonly rootReferences: readonly RootReference[];
  readonly recovery: string;
}

const candidateText = (source: string, text: string): string => {
  if (source === STANDALONE_FILE) {
    return text;
  }
  const shared: unknown = Bun.TOML.parse(text);
  if (
    shared === null ||
    typeof shared !== "object" ||
    !("cinch" in shared) ||
    shared.cinch === null ||
    typeof shared.cinch !== "object" ||
    Array.isArray(shared.cinch)
  ) {
    throw new Error(`Missing [cinch] in ${source}.`);
  }
  const candidate = Bun.TOML.stringify(shared.cinch);
  if (!Bun.deepEquals(Bun.TOML.parse(candidate), shared.cinch)) {
    throw new Error(`Could not preserve the settings in ${source}.`);
  }
  return candidate;
};

const movesFor = ({ paths }: Plan) => {
  const managed = paths.flatMap(({ path: from, layer, steps }) => {
    if (!from.startsWith(`${CINCH_MANAGED_DIR}/`)) {
      return [];
    }
    const to = ROPES_MANAGED_DIR + from.slice(CINCH_MANAGED_DIR.length);
    return [{ from, layer, steps, to }];
  });
  const rootReferences: RootReference[] = paths
    .filter(({ layer }) => layer === "root")
    .flatMap(({ path: root, steps }) => {
      const choices = managed.filter((file) =>
        steps.some((step) =>
          file.steps.some((lower) => lower.adapter === step.adapter)
        )
      );
      const target =
        choices.find(({ layer }) => layer === "generated") ?? choices[0];
      return target === undefined
        ? []
        : [{ from: target.from, path: root, to: target.to }];
    });
  return {
    managedFiles: managed.map(({ from, to }) => ({ from, to })),
    rootReferences,
  };
};

/** Skip the preview when keeping a selector would change what it governs. */
const changedSelectors = (
  config: CinchConfig,
  managed: readonly string[]
): string[] => {
  const selectors = [
    { key: "include", patterns: config.include.value },
    { key: "exclude", patterns: config.exclude.value },
    ...config.overrides.map(({ paths }, index) => ({
      key: `overrides.${index}.paths`,
      patterns: paths,
    })),
  ];
  const moved = managed.filter((file) =>
    file.startsWith(`${CINCH_MANAGED_DIR}/`)
  );
  return selectors.flatMap(({ key, patterns }) => {
    const matches = compileGlobs(patterns);
    return moved.flatMap((old) => {
      const next = ROPES_MANAGED_DIR + old.slice(CINCH_MANAGED_DIR.length);
      return matches(old) === matches(next)
        ? []
        : [
            `${config.file}: \`${config.prefix ?? ""}${key}\` treats ${old} and ${next} differently. Review the path patterns before migrating.`,
          ];
    });
  });
};

/** Describe the cutover using the active setup plan and the original policy. */
export const runMigrationPreview = async (
  cwd: string,
  deps: CommandDeps
): Promise<Operation<MigrationPreview>> => {
  const prepared = await prepareSetup(cwd, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { plan, root } = prepared.value;
  const source = root.configFile;
  if (source !== SHARED_FILE && source !== STANDALONE_FILE) {
    return {
      error: "There is no legacy Cinch config to migrate at this root.",
      ok: false,
    };
  }
  const problems = changedSelectors(
    prepared.value.config,
    prepared.value.adapters.flatMap(({ descriptor }) => descriptor.owns ?? [])
  );
  if (problems.length > 0) {
    return { error: problems.join("\n"), ok: false };
  }
  try {
    const original = await Bun.file(path.join(root.root, source)).text();
    return {
      ok: true,
      value: {
        ...movesFor(plan),
        recovery:
          "Keep the old config and .outfitter/configs/ files. To recover from a later cutover, restore the old policy and root tool references from the pre-migration revision and remove rope.toml.",
        schemaVersion: SCHEMA_VERSION,
        source: {
          path: source,
          ...(source === SHARED_FILE ? { table: "cinch" } : {}),
        },
        target: { path: ROPES_FILE, text: candidateText(source, original) },
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};
