import { z } from "zod";

import { DEFAULT_CONFIG, PILOT_VERSION } from "../contracts/config.ts";
import type {
  CinchConfig,
  ConfigOverride,
  ConfigResult,
  Sourced,
} from "../contracts/config.ts";
import type { PolicyValue, Provenance } from "../contracts/plan.ts";

const Globs = z.array(z.string().min(1));
const ProfileSchema = z.strictObject({ enabled: z.boolean().optional() });
const OverrideSchema = z.strictObject({
  markdown: ProfileSchema.optional(),
  paths: Globs.min(1),
});
const FileSchema = z.strictObject({
  exclude: Globs.optional(),
  include: Globs.optional(),
  markdown: ProfileSchema.optional(),
  overrides: z.array(OverrideSchema).optional(),
  pilot: z.literal(PILOT_VERSION),
});
const VersionedSchema = z.looseObject({ pilot: z.unknown().optional() });

type Profile = z.infer<typeof ProfileSchema>;

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

const markdownSetting = (
  profile: Profile | undefined,
  source: Provenance
): PolicyValue[] =>
  profile?.enabled === undefined
    ? []
    : [{ key: "markdown.enabled", source, value: profile.enabled }];

const build = (
  table: z.infer<typeof FileSchema>,
  origin: TableOrigin
): CinchConfig => {
  const base = markdownSetting(
    table.markdown,
    from(origin, "markdown.enabled")
  );
  const overrides: ConfigOverride[] = (table.overrides ?? []).map(
    (override, index) => ({
      paths: override.paths,
      settings: markdownSetting(
        override.markdown,
        from(origin, `overrides.${index}.markdown.enabled`)
      ),
    })
  );
  return {
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
    settings: base.length > 0 ? base : DEFAULT_CONFIG.settings,
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
  const parsed = FileSchema.safeParse(table);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${origin.prefix}${issue.path.join(".")}: ${issue.message}`
    );
    return { error: { file, issues, kind: "invalid" }, ok: false };
  }
  return { ok: true, value: build(parsed.data, origin) };
};
