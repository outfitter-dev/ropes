import { z } from "zod";

import { DEFAULT_CONFIG, PILOT_VERSION } from "../contracts/config.ts";
import type {
  CinchConfig,
  ConfigOverride,
  ConfigResult,
  Sourced,
} from "../contracts/config.ts";
import { EditorSchema } from "../contracts/editor.ts";
import type { PolicyValue, Provenance } from "../contracts/plan.ts";

const Globs = z.array(z.string().min(1));
const ProfileSchema = z.strictObject({
  enabled: z
    .boolean()
    .optional()
    .describe("Whether Markdown is checked. On unless set to false."),
  preset: z
    .boolean()
    .optional()
    .describe(
      "Whether Cinch keeps the shared Markdown standard in the repository."
    ),
});
const TomlSchema = z.strictObject({
  enabled: z
    .boolean()
    .optional()
    .describe("Whether TOML is checked. On unless set to false."),
});
/** A shared config that is kept only when the repository asks for it. */
const optInPreset = (what: string) =>
  z.strictObject({
    preset: z
      .boolean()
      .optional()
      .describe(
        `Whether Cinch keeps the shared ${what} in the repository. Off unless set to true.`
      ),
  });
const OPT_IN = {
  format: optInPreset("formatter config"),
  lint: optInPreset("lint config"),
  typescript: optInPreset("TypeScript compiler options"),
};
const OverrideSchema = z.strictObject({
  markdown: ProfileSchema.optional(),
  paths: Globs.min(1).describe(
    "Root-relative globs. The settings beside them apply to matching files."
  ),
  toml: TomlSchema.optional(),
});
/**
 * The shape of `cinch.toml`, and of the `[cinch]` table in `outfitter.toml`.
 * The loader and the published JSON Schema both come from this definition.
 */
export const ConfigFileSchema = z.strictObject({
  editor: EditorSchema.optional().describe(
    "Facts about text files that several tools must agree on. Cinch writes the root editor settings file from this table."
  ),
  exclude: Globs.optional().describe(
    "Root-relative globs for files Cinch leaves alone."
  ),
  format: OPT_IN.format.optional(),
  include: Globs.optional().describe(
    "Root-relative globs for the files Cinch checks."
  ),
  lint: OPT_IN.lint.optional(),
  markdown: ProfileSchema.optional(),
  overrides: z
    .array(OverrideSchema)
    .optional()
    .describe("Settings for some paths. A later entry wins over an earlier."),
  pilot: z
    .literal(PILOT_VERSION)
    .describe("The version of this unstable format. It must be stated."),
  toml: TomlSchema.optional(),
  tools: z
    .record(z.string().min(1), z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "One table for each tool, in the tool's own settings. Cinch copies it into the config it generates for that tool."
    ),
  typescript: OPT_IN.typescript.optional(),
});
const VersionedSchema = z.looseObject({ pilot: z.unknown().optional() });

/** Where a config table sits: its file, and the key prefix inside that file. */
export interface TableOrigin {
  /** Root-relative file name. */
  readonly file: string;
  /** Empty for `cinch.toml`, `cinch.` for the table in `outfitter.toml`. */
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
/** The tables a file can state. An override states the first two only. */
const SETTING_TABLES = [
  "markdown",
  "toml",
  "format",
  "lint",
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

const build = (
  table: z.infer<typeof ConfigFileSchema>,
  origin: TableOrigin
): CinchConfig => {
  const base = settingsOf(table, origin, "");
  const overrides: ConfigOverride[] = (table.overrides ?? []).map(
    (override, index) => ({
      paths: override.paths,
      settings: settingsOf(override, origin, `overrides.${index}.`),
    })
  );
  return {
    ...(table.editor === undefined ? {} : { editor: table.editor }),
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
