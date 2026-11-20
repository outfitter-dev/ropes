import { check, exitCodeOf, explain, fix } from "@ropes/core";

const [verb, file] = process.argv.slice(2);
const request = { cwd: process.cwd(), paths: file === undefined ? [] : [file] };

if (verb === "explain") {
  const ran = await explain(request);
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value.plan));
} else if (verb === "fix") {
  const ran = await fix({ ...request, dryRun: true });
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value));
  process.exitCode = exitCodeOf(ran.value.result);
} else {
  const ran = await check(request);
  if (!ran.ok) {
    throw new Error(ran.error);
  }
  console.log(JSON.stringify(ran.value));
  process.exitCode = exitCodeOf(ran.value);
}
