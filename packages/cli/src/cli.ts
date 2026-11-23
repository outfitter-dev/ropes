#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  check,
  doctor,
  explain,
  EXIT_CODE,
  exitCodeOf,
  fix,
  previewMigration,
  prepareRuntime,
  STANDALONE,
  trace,
} from "@ropes/core";
import type { MigrationPreview, ReadRequest } from "@ropes/core";
import {
  doctorOutcome,
  renderDoctor,
  renderDoctorJson,
  renderFix,
  renderFixJson,
  renderHuman,
  renderJson,
  renderPlan,
  renderPlanJson,
  renderTrace,
} from "@ropes/core/render";

import { migrationCommand } from "./cleanup.ts";
import { delegate } from "./delegate.ts";
import { HELP, version } from "./help.ts";
import { initialize } from "./initialize.ts";
import { fail, print } from "./output.ts";
import { policy } from "./policy.ts";
import { schema } from "./schema.ts";

const renderMigration = (preview: MigrationPreview): string => {
  const { source, target, managedFiles, rootReferences, recovery } = preview;
  const table = source.table === undefined ? "" : ` [${source.table}]`;
  return [
    `Migration preview from ${source.path}${table} to ${target.path}. No files written.`,
    "",
    target.text.trimEnd(),
    "",
    ...managedFiles.map(({ from, to }) => `  ${from} -> ${to}`),
    ...rootReferences.map(
      ({ from, path, to }) =>
        `  ${path}: change the reference from ${from} to ${to}`
    ),
    "",
    recovery,
  ].join("\n");
};

const migrate = async (
  cwd: string,
  paths: readonly string[],
  json: boolean
): Promise<number> => {
  if (paths.length > 0) {
    return fail(
      "migrate previews the whole configuration, so it takes no paths.",
      json
    );
  }
  const ran = await previewMigration(cwd);
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  print(json ? JSON.stringify(ran.value, null, 2) : renderMigration(ran.value));
  return EXIT_CODE.clean;
};

const showExplanation = async (
  request: ReadRequest,
  json: boolean,
  detailed: boolean
): Promise<number> => {
  if (detailed) {
    const traced = await trace(request);
    if (!traced.ok) {
      return fail(traced.error, json);
    }
    print(
      json ? JSON.stringify(traced.value, null, 2) : renderTrace(traced.value)
    );
    return EXIT_CODE.clean;
  }
  const ran = await explain(request, !json);
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  const { plan } = ran.value;
  print(json ? renderPlanJson(plan) : renderPlan(plan, ran.value));
  return EXIT_CODE.clean;
};

const invocation = (argv: readonly string[]) =>
  parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      at: { type: "string" },
      candidate: { type: "string" },
      "dry-run": { type: "boolean" },
      fix: { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      migration: { type: "string" },
      parent: { type: "string" },
      strict: { type: "boolean" },
      trace: { type: "boolean" },
      version: { short: "v", type: "boolean" },
      yes: { type: "boolean" },
    },
  });

const incompatibleOption = (
  verb: string,
  values: ReturnType<typeof invocation>["values"]
): string | undefined => {
  if (values.fix === true && verb !== "doctor") {
    return "--fix is only for doctor.";
  }
  if (
    values["dry-run"] === true &&
    !["fix", "init", "migrate"].includes(verb) &&
    !(verb === "doctor" && values.fix === true)
  ) {
    return "--dry-run is only for fix, init, migrate, and doctor --fix.";
  }
  if (values.yes === true && verb !== "init") {
    return "--yes is only for init.";
  }
  if (values.trace === true && verb !== "explain") {
    return "--trace is only for explain.";
  }
  if (
    values.at !== undefined &&
    !["explain", "check", "policy"].includes(verb)
  ) {
    return "--at is only for explain, check, and policy snapshot.";
  }
  return undefined;
};

const checkPaths = async (
  request: ReadRequest,
  json: boolean
): Promise<number> => {
  const ran = await check(request);
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  print(json ? renderJson(ran.value) : renderHuman(ran.value));
  return exitCodeOf(ran.value);
};

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = invocation(argv);
  const [verb, ...paths] = positionals;
  if (values.version === true) {
    print(version(import.meta.filename));
    return EXIT_CODE.clean;
  }
  if (values.help === true || verb === undefined) {
    print(HELP.trimEnd());
    return EXIT_CODE.clean;
  }
  const json = values.json === true;
  const optionProblem = incompatibleOption(verb, values);
  if (optionProblem !== undefined) {
    return fail(optionProblem, json);
  }
  const migrationResult = await migrationCommand(verb, paths, values, json);
  if (migrationResult !== null) {
    return migrationResult;
  }
  const request = {
    ...(values.at === undefined ? {} : { at: values.at }),
    cwd: process.cwd(),
    paths,
    strict: values.strict === true || process.env.CI === "true",
  };
  switch (verb) {
    case "explain": {
      return await showExplanation(request, json, values.trace === true);
    }
    case "check": {
      return await checkPaths(request, json);
    }
    case "doctor": {
      const ran = await doctor({
        ...request,
        dryRun: values["dry-run"] === true,
        fix: values.fix === true,
      });
      if (!ran.ok) {
        return fail(ran.error, json);
      }
      print(
        json ? renderDoctorJson(ran.value) : renderDoctor(ran.value, "rope")
      );
      return EXIT_CODE[doctorOutcome(ran.value)];
    }
    case "fix": {
      const ran = await fix({ ...request, dryRun: values["dry-run"] === true });
      if (!ran.ok) {
        return fail(ran.error, json);
      }
      print(json ? renderFixJson(ran.value) : renderFix(ran.value));
      return exitCodeOf(ran.value.result);
    }
    case "init": {
      return await initialize(request, values, json);
    }
    case "policy": {
      return await policy(request, json);
    }
    case "migrate": {
      return await migrate(request.cwd, paths, json);
    }
    case "schema": {
      return schema(paths, json);
    }
    default: {
      return fail(`unknown command "${verb}". Run rope --help.`, json);
    }
  }
};

const argv = process.argv.slice(2);
try {
  if (!(await prepareRuntime(process.argv, process.cwd()))) {
    process.exitCode =
      (STANDALONE ? null : await delegate(argv)) ?? (await main(argv));
  }
} catch (error) {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  process.exitCode = fail(
    error instanceof Error ? error.message : String(error),
    options.includes("--json")
  );
}
