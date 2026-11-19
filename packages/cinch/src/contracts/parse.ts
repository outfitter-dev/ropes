import { z } from "zod";

import { FindingSchema } from "./finding.ts";
import type { Finding } from "./finding.ts";
import { PlanSchema, SCHEMA_VERSION } from "./plan.ts";
import type { Plan } from "./plan.ts";
import { ResultSchema } from "./result.ts";
import type { Result } from "./result.ts";

export type ContractError =
  /** The document names a schema version this build does not know. */
  | { readonly kind: "unknown-version"; readonly found: unknown }
  | { readonly kind: "invalid"; readonly issues: readonly string[] };

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ContractError };

const VersionedSchema = z.object({ schemaVersion: z.unknown() });

const issuesOf = (error: z.ZodError): readonly string[] =>
  error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

const parseWith = <T>(schema: z.ZodType<T>, input: unknown): Parsed<T> => {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { error: { issues: issuesOf(parsed.error), kind: "invalid" }, ok: false };
};

/** Checks the version first, so an unknown version is never read as a shape error. */
const parseVersioned = <T>(schema: z.ZodType<T>, input: unknown): Parsed<T> => {
  const versioned = VersionedSchema.safeParse(input);
  if (versioned.success && versioned.data.schemaVersion !== SCHEMA_VERSION) {
    return {
      error: { found: versioned.data.schemaVersion, kind: "unknown-version" },
      ok: false,
    };
  }
  return parseWith(schema, input);
};

export const parsePlan = (input: unknown): Parsed<Plan> =>
  parseVersioned(PlanSchema, input);

export const parseResult = (input: unknown): Parsed<Result> =>
  parseVersioned(ResultSchema, input);

/** A finding carries no version of its own. It is versioned by its result. */
export const parseFinding = (input: unknown): Parsed<Finding> =>
  parseWith(FindingSchema, input);
