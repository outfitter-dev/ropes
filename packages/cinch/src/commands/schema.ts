import { z } from "zod";

import { FailureSchema } from "../contracts/failure.ts";
import { FixReportSchema } from "../contracts/fix.ts";
import { InitReportSchema } from "../contracts/init.ts";
import { PlanSchema, SCHEMA_VERSION } from "../contracts/plan.ts";
import { PresetReportSchema } from "../contracts/preset.ts";
import { EXIT_CODE, ResultSchema } from "../contracts/result.ts";
import type { Command } from "./command.ts";

/**
 * What each command prints on stdout with `--json`. `failure` is what any of
 * them prints on stderr when it could not run.
 */
export const OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  check: ResultSchema,
  explain: PlanSchema,
  failure: FailureSchema,
  fix: FixReportSchema,
  init: InitReportSchema,
  preset: PresetReportSchema,
  "preset add": FixReportSchema,
  "preset list": PresetReportSchema,
  "preset update": FixReportSchema,
};

const NAMES = Object.keys(OUTPUT_SCHEMAS).toSorted();

const print = (value: unknown): string => JSON.stringify(value, null, 2);

const listing = (json: boolean): string =>
  json
    ? print({ commands: NAMES, schemaVersion: SCHEMA_VERSION })
    : [
        "Run `cinch schema <command>` for the JSON Schema of its --json output.",
        "",
        ...NAMES.map((name) => `  ${name}`),
      ].join("\n");

/**
 * `cinch schema <command>` prints the JSON Schema of what that command prints
 * with `--json`, so a jq filter can be written without running it first. With
 * no command it lists the names. It reads nothing and runs nothing.
 */
export const schema: Command = (request) => {
  const name = request.paths.join(" ");
  if (name === "") {
    return Promise.resolve({
      exitCode: EXIT_CODE.clean,
      output: listing(request.json),
    });
  }
  const found = Object.hasOwn(OUTPUT_SCHEMAS, name)
    ? OUTPUT_SCHEMAS[name]
    : undefined;
  if (!found) {
    return Promise.resolve({
      error: `cinch: no schema for "${name}". Run \`cinch schema\` for the names.`,
      exitCode: EXIT_CODE.incomplete,
    });
  }
  return Promise.resolve({
    exitCode: EXIT_CODE.clean,
    output: print(z.toJSONSchema(found)),
  });
};
