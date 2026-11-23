import { z } from "zod";

import { ROPES_FILE } from "../config/load.ts";
import { configJsonSchema } from "../config/schema.ts";
import { CleanupReportSchema } from "../contracts/cleanup.ts";
import { DoctorReportSchema } from "../contracts/doctor.ts";
import { FailureSchema } from "../contracts/failure.ts";
import { FixReportSchema } from "../contracts/fix.ts";
import { InitReportSchema } from "../contracts/init.ts";
import { PlanSchema, SCHEMA_VERSION } from "../contracts/plan.ts";
import { PresetReportSchema } from "../contracts/preset.ts";
import { RelocateReportSchema } from "../contracts/relocate.ts";
import { EXIT_CODE, ResultSchema } from "../contracts/result.ts";
import {
  RulesAdoptReportSchema,
  RulesReportSchema,
} from "../contracts/rules-report.ts";
import type { Command } from "./command.ts";

/**
 * What each command prints on stdout with `--json`. `failure` is what any of
 * them prints on stderr when it could not run.
 */
export const OUTPUT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  check: ResultSchema,
  "check migration": CleanupReportSchema,
  doctor: DoctorReportSchema,
  explain: PlanSchema,
  "explain migration": CleanupReportSchema,
  failure: FailureSchema,
  fix: FixReportSchema,
  init: InitReportSchema,
  preset: PresetReportSchema,
  "preset add": FixReportSchema,
  "preset adopt": RelocateReportSchema,
  "preset eject": RelocateReportSchema,
  "preset list": PresetReportSchema,
  "preset update": FixReportSchema,
  rules: RulesReportSchema,
  "rules adopt": RulesAdoptReportSchema,
  "rules list": RulesReportSchema,
};

const NAMES = Object.keys(OUTPUT_SCHEMAS).toSorted();

/** The name that asks for the schema of the config file, not of an output. */
export const CONFIG_NAME = "config";

const ROPES_OUTPUTS: readonly string[] = [
  "check",
  "doctor",
  "explain",
  "failure",
  "fix",
];

export const listRopesSchemas = () => ({
  commands: ROPES_OUTPUTS,
  files: [CONFIG_NAME],
  schemaVersion: SCHEMA_VERSION,
});

export const ropesSchema = (name: string) => {
  if (name === CONFIG_NAME) {
    return configJsonSchema(ROPES_FILE);
  }
  const schema = ROPES_OUTPUTS.includes(name)
    ? OUTPUT_SCHEMAS[name]
    : undefined;
  return schema === undefined ? undefined : z.toJSONSchema(schema);
};

const print = (value: unknown): string => JSON.stringify(value, null, 2);

const listing = (json: boolean): string =>
  json
    ? print({
        commands: NAMES,
        files: [CONFIG_NAME],
        schemaVersion: SCHEMA_VERSION,
      })
    : [
        "Run `cinch schema <command>` for the JSON Schema of its --json output.",
        "",
        ...NAMES.map((name) => `  ${name}`),
        "",
        `Run \`cinch schema ${CONFIG_NAME}\` for the JSON Schema of the Cinch config file.`,
      ].join("\n");

/**
 * `cinch schema <command>` prints the JSON Schema of what that command prints
 * with `--json`, so a jq filter can be written without running it first. With
 * no command it lists the names. `cinch schema config` prints the schema of
 * the config file instead. It reads nothing and runs nothing.
 */
export const schema: Command = (request) => {
  const name = request.paths.join(" ");
  if (name === "") {
    return Promise.resolve({
      exitCode: EXIT_CODE.clean,
      output: listing(request.json),
    });
  }
  if (name === CONFIG_NAME) {
    return Promise.resolve({
      exitCode: EXIT_CODE.clean,
      output: print(configJsonSchema()),
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
