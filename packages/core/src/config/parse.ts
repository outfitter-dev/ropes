import { z } from "zod";

import { DEFAULT_CONFIG, PILOT_VERSION } from "../contracts/config.ts";
import type {
  RopesConfig,
  ConfigOverride,
  ConfigResult,
  Sourced,
} from "../contracts/config.ts";
import { EditorSchema } from "../contracts/editor.ts";
import { ENFORCEMENT_PREFIX } from "../contracts/enforcement.ts";
import type { EnforcementSetting } from "../contracts/enforcement.ts";
import { InstallSchema } from "../contracts/install.ts";
import type { PolicyValue, Provenance } from "../contracts/plan.ts";
import {
  Globs,
  OPT_IN,
  overrideSwitch,
  ProfileSchema,
  RuleSwitchSchema,
  TomlSchema,
} from "./tables.ts";

const OverrideSchema = z.strictObject({
  format: overrideSwitch("the matching files are held to the formatter"),
  lint: overrideSwitch("the matching files are linted"),
  markdown: ProfileSchema.optional(),
  paths: Globs.min(1).describe(
    "Root-relative globs. The settings beside them apply to matching files."
  ),
  rules: RuleSwitchSchema.optional(),
  toml: TomlSchema.optional(),
  typescript: overrideSwitch("the matching files are type checked"),
});
/**
 * The shape of `rope.toml`.
 * The loader and the published JSON Schema both come from this definition.
 */
export const ConfigFileSchema = z.strictObject({
  editor: EditorSchema.optional().describe(
    "Facts about text files that several tools must agree on. Ropes writes the root editor settings file from this table."
  ),
  exclude: Globs.optional().describe(
    "Root-relative globs for files Ropes leaves alone."
  ),
  format: OPT_IN.format.optional(),
  include: Globs.optional().describe(
    "Root-relative globs for the files Ropes checks."
  ),
  install: InstallSchema.optional(),
  lint: OPT_IN.lint.optional(),
  markdown: ProfileSchema.optional(),
  overrides: z
    .array(OverrideSchema)
    .optional()
    .describe("Settings for some paths. A later entry wins over an earlier."),
  pilot: z
    .literal(PILOT_VERSION)
    .describe("The version of this unstable format. It must be stated."),
  rules: OPT_IN.rules.optional(),
  toml: TomlSchema.optional(),
  tools: z
    .record(z.string().min(1), z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "One table for each tool, in the tool's own settings. Ropes copies it into the config it generates for that tool."
    ),
  typescript: OPT_IN.typescript.optional(),
});
const VersionedSchema = z.looseObject({ pilot: z.unknown().optional() });

/** Where a config table sits: its file, and the key prefix inside that file. */
export interface TableOrigin {
  /** Root-relative file name. */
  readonly file: string;
  /** Empty for a top-level policy. Nested table callers include the trailing dot. */
  readonly prefix: string;
}

const from = (origin: TableOrigin, key: string): Provenance => ({
  file: origin.file,
  key: `${origin.prefix}${key}`,
  kind: "file",
});

const sourced = <T>(
  value: T | undefined,
  fallback: Sourced<T>,
  source: Provenance
): Sourced<T> => (value === undefined ? fallback : { source, value });

/** The tables that hold settings, as a file or an override states them. */
type Switches = Readonly<Record<string, boolean | undefined>> | undefined;
/** The tables a file can state. An override states some of them. */
const SETTING_TABLES = [
  "markdown",
  "toml",
  "format",
  "lint",
  "rules",
  "typescript",
] as const;
type Tables = Readonly<
  Partial<Record<(typeof SETTING_TABLES)[number], Switches>>
>;

/** One setting per key the tables state, sourced under `prefix`. */
const settingsOf = (
  tables: Tables,
  origin: TableOrigin,
  prefix: string
): PolicyValue[] =>
  SETTING_TABLES.flatMap((table) =>
    Object.entries(tables[table] ?? {}).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [
            {
              key: `${table}.${key}`,
              source: from(origin, `${prefix}${table}.${key}`),
              value,
            },
          ]
    )
  );

/** The defaults, with every key the file states replacing its default. */
const overDefaults = (stated: readonly PolicyValue[]): PolicyValue[] => {
  const keys = new Set(stated.map((setting) => setting.key));
  return [
    ...DEFAULT_CONFIG.settings.filter((setting) => !keys.has(setting.key)),
    ...stated,
  ];
};

const enforcementSettings = (
  settings: Readonly<Record<string, EnforcementSetting>> | undefined,
  origin: TableOrigin,
  prefix: string
): PolicyValue[] =>
  Object.entries(settings ?? {}).map(([rule, value]) => ({
    key: `${ENFORCEMENT_PREFIX}${rule}`,
    source: from(origin, `${prefix}${ENFORCEMENT_PREFIX}${rule}`),
    value,
  }));

const build = (
  table: z.infer<typeof ConfigFileSchema>,
  origin: TableOrigin
): RopesConfig => {
  const { enforcement, local, off, packs, ...rules } = table.rules ?? {};
  const base = [
    ...settingsOf({ ...table, rules }, origin, ""),
    ...(table.editor?.check === undefined
      ? []
      : [
          {
            key: "editor.check",
            source: from(origin, "editor.check"),
            value: table.editor.check,
          },
        ]),
    ...enforcementSettings(enforcement, origin, ""),
  ];
  const overrides: ConfigOverride[] = (table.overrides ?? []).map(
    (override, index) => {
      const { enforcement: levels, ...switches } = override.rules ?? {};
      const prefix = `overrides.${index}.`;
      return {
        paths: override.paths,
        settings: [
          ...settingsOf({ ...override, rules: switches }, origin, prefix),
          ...enforcementSettings(levels, origin, prefix),
        ],
      };
    }
  );
  return {
    ...(table.editor === undefined ? {} : { editor: table.editor }),
    ...(table.install === undefined ? {} : { install: table.install }),
    exclude: sourced(
      table.exclude,
      DEFAULT_CONFIG.exclude,
      from(origin, "exclude")
    ),
    file: origin.file,
    include: sourced(
      table.include,
      DEFAULT_CONFIG.include,
      from(origin, "include")
    ),
    overrides,
    ...(origin.prefix === "" ? {} : { prefix: origin.prefix }),
    ...(local === undefined
      ? {}
      : { rulesLocal: { source: from(origin, "rules.local"), value: local } }),
    ...(off === undefined
      ? {}
      : { rulesOff: { source: from(origin, "rules.off"), value: off } }),
    ...(packs === undefined
      ? {}
      : { rulesPacks: { source: from(origin, "rules.packs"), value: packs } }),
    settings: overDefaults(base),
    tools: table.tools ?? {},
  };
};

/**
 * Turns one parsed config table into a config. Checks the version marker
 * first, so an unknown version is never reported as a shape error.
 */
export const parseConfigTable = (
  table: unknown,
  origin: TableOrigin
): ConfigResult => {
  const { file } = origin;
  const versioned = VersionedSchema.safeParse(table);
  if (versioned.success && versioned.data.pilot === undefined) {
    return { error: { file, kind: "missing-version" }, ok: false };
  }
  if (versioned.success && versioned.data.pilot !== PILOT_VERSION) {
    return {
      error: { file, found: versioned.data.pilot, kind: "unknown-version" },
      ok: false,
    };
  }
  const parsed = ConfigFileSchema.safeParse(table);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${origin.prefix}${issue.path.join(".")}: ${issue.message}`
    );
    return { error: { file, issues, kind: "invalid" }, ok: false };
  }
  return { ok: true, value: build(parsed.data, origin) };
};
