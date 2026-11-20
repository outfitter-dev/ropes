#!/usr/bin/env bun
import { parseArgs } from "node:util";

import { check, explain, exitCodeOf, fix } from "@ropes/core";

import manifest from "./package.json" with { type: "json" };

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean" },
    json: { type: "boolean" },
    strict: { type: "boolean" },
    version: { type: "boolean" },
  },
});
const [verb, ...paths] = positionals;
const request = {
  cwd: process.cwd(),
  paths,
  strict: values.strict === true || process.env.CI === "true",
};

if (values.version === true) {
  console.log(
    `outfitter ${manifest.version} (@ropes/core ${manifest.dependencies["@ropes/core"]})`
  );
} else if (verb === "explain") {
  const ran = await explain(request);
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value.plan));
} else if (verb === "check") {
  const ran = await check(request);
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value));
  process.exitCode = exitCodeOf(ran.value);
} else if (verb === "fix") {
  const ran = await fix({ ...request, dryRun: values["dry-run"] === true });
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value));
  process.exitCode = exitCodeOf(ran.value.result);
} else {
  throw new Error(
    "The private fixture supports explain, check, fix and --version."
  );
}
