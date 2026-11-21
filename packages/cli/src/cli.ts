#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  check,
  explain,
  EXIT_CODE,
  exitCodeOf,
  fix,
  previewMigration,
  trace,
} from "@ropes/core";
import type { MigrationPreview, ReadRequest } from "@ropes/core";
import {
  renderFix,
  renderFixJson,
  renderHuman,
  renderJson,
  renderPlan,
  renderPlanJson,
  renderTrace,
} from "@ropes/core/render";

import manifest from "../package.json" with { type: "json" };
import { migrationCommand } from "./cleanup.ts";
import { delegate } from "./delegate.ts";
import { fail, print } from "./output.ts";

const HELP = `rope ${manifest.version}

Usage: rope <explain|check|fix> [path...] [--json] [--strict]
       rope <explain|check> [path...] --at <UTC instant>
       rope fix [path...] --dry-run
       rope explain [path...] --trace [--json]
       rope migrate [--dry-run] [--json]
       rope <explain|check> --migration <commit>:<file> --parent <commit> --candidate <commit>

  explain   Show which checks apply and where the policy comes from
  check     Check the selected files without writing to the repository
  fix       Fix the selected files or preview changes with --dry-run
  migrate   Preview a legacy Cinch config migration

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

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
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      migration: { type: "string" },
      parent: { type: "string" },
      strict: { type: "boolean" },
      trace: { type: "boolean" },
      version: { short: "v", type: "boolean" },
    },
  });

const incompatibleOption = (
  verb: string,
  values: ReturnType<typeof invocation>["values"]
): string | undefined => {
  if (values["dry-run"] === true && verb !== "fix" && verb !== "migrate") {
    return "--dry-run is only for fix and migrate.";
  }
  if (values.trace === true && verb !== "explain") {
    return "--trace is only for explain.";
  }
  if (values.at !== undefined && verb !== "explain" && verb !== "check") {
    return "--at is only for explain and check.";
  }
  return undefined;
};

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = invocation(argv);
  const [verb, ...paths] = positionals;
  if (values.version === true) {
    print(`rope ${manifest.version}\n${import.meta.filename}`);
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
      const ran = await check(request);
      if (!ran.ok) {
        return fail(ran.error, json);
      }
      print(json ? renderJson(ran.value) : renderHuman(ran.value));
      return exitCodeOf(ran.value);
    }
    case "fix": {
      const ran = await fix({ ...request, dryRun: values["dry-run"] === true });
      if (!ran.ok) {
        return fail(ran.error, json);
      }
      print(json ? renderFixJson(ran.value) : renderFix(ran.value));
      return exitCodeOf(ran.value.result);
    }
    case "migrate": {
      return await migrate(request.cwd, paths, json);
    }
    default: {
      return fail(`unknown command "${verb}". Run rope --help.`, json);
    }
  }
};

const argv = process.argv.slice(2);
try {
  process.exitCode = (await delegate(argv)) ?? (await main(argv));
} catch (error) {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  process.exitCode = fail(
    error instanceof Error ? error.message : String(error),
    options.includes("--json")
  );
}
