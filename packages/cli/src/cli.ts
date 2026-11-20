#!/usr/bin/env bun
import { parseArgs } from "node:util";

import { check, explain, EXIT_CODE, exitCodeOf, fix } from "@ropes/core";
import {
  renderFailureJson,
  renderFix,
  renderFixJson,
  renderHuman,
  renderJson,
  renderPlan,
  renderPlanJson,
} from "@ropes/core/render";

import manifest from "../package.json" with { type: "json" };

const HELP = `rope ${manifest.version}

Usage: rope <explain|check|fix> [path...] [--json] [--strict]
       rope fix [path...] --dry-run

  explain   Show which checks apply and where the policy comes from
  check     Check the selected files without writing to the repository
  fix       Fix the selected files or preview changes with --dry-run

Exit codes: 0 clean, 1 findings remain, 2 incomplete or unusable.
`;

const print = (output: string): void => {
  process.stdout.write(`${output}\n`);
};

const fail = (message: string, json: boolean): number => {
  process.stderr.write(
    `${json ? renderFailureJson(message) : `rope: ${message}`}\n`
  );
  return EXIT_CODE.incomplete;
};

const main = async (argv: readonly string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    args: [...argv],
    options: {
      "dry-run": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      json: { type: "boolean" },
      strict: { type: "boolean" },
      version: { short: "v", type: "boolean" },
    },
  });
  const [verb, ...paths] = positionals;
  if (values.version === true) {
    print(manifest.version);
    return EXIT_CODE.clean;
  }
  if (values.help === true || verb === undefined) {
    print(HELP.trimEnd());
    return EXIT_CODE.clean;
  }
  const json = values.json === true;
  if (values["dry-run"] === true && verb !== "fix") {
    return fail("--dry-run is only for fix.", json);
  }
  const request = {
    cwd: process.cwd(),
    paths,
    strict: values.strict === true || process.env.CI === "true",
  };
  switch (verb) {
    case "explain": {
      const ran = await explain(request, !json);
      if (!ran.ok) {
        return fail(ran.error, json);
      }
      const { plan } = ran.value;
      print(json ? renderPlanJson(plan) : renderPlan(plan, ran.value));
      return EXIT_CODE.clean;
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
    default: {
      return fail(`unknown command "${verb}". Run rope --help.`, json);
    }
  }
};

const argv = process.argv.slice(2);
try {
  process.exitCode = await main(argv);
} catch (error) {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  process.exitCode = fail(
    error instanceof Error ? error.message : String(error),
    options.includes("--json")
  );
}
