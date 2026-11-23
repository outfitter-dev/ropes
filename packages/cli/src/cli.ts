#!/usr/bin/env bun
import {
  check,
  doctor,
  EXIT_CODE,
  exitCodeOf,
  fix,
  previewMigration,
  prepareRuntime,
  STANDALONE,
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
} from "@ropes/core/render";

import { incompatibleOption, invocation } from "./args.ts";
import { migrationCommand } from "./cleanup.ts";
import { delegate } from "./delegate.ts";
import { showExplanation } from "./explain.ts";
import { HELP, version } from "./help.ts";
import { initialize } from "./initialize.ts";
import { fail, print } from "./output.ts";
import { policy } from "./policy.ts";
import { presetCommand } from "./preset.ts";
import { rulesCommand } from "./rules.ts";
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

const dispatch = async (
  verb: string,
  request: ReadRequest,
  values: ReturnType<typeof invocation>["values"],
  json: boolean
): Promise<number> => {
  const { paths } = request;
  switch (verb) {
    case "explain": {
      return await showExplanation(
        request,
        json,
        values.trace === true,
        values.rule
      );
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
    case "preset": {
      return await presetCommand(request, {
        dryRun: values["dry-run"] === true,
        json,
        yes: values.yes === true,
      });
    }
    case "rules": {
      return await rulesCommand(request, values, json);
    }
    case "schema": {
      return schema(paths, json);
    }
    default: {
      return fail(`unknown command "${verb}". Run rope --help.`, json);
    }
  }
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
  return await dispatch(verb, request, values, json);
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
