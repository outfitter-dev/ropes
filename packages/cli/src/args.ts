import { parseArgs } from "node:util";

export const invocation = (argv: readonly string[]) =>
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
      rule: { type: "string" },
      strict: { type: "boolean" },
      trace: { type: "boolean" },
      version: { short: "v", type: "boolean" },
      yes: { short: "y", type: "boolean" },
    },
  });

export const incompatibleOption = (
  verb: string,
  values: ReturnType<typeof invocation>["values"]
): string | undefined => {
  if (values.fix === true && verb !== "doctor") {
    return "--fix is only for doctor.";
  }
  if (
    values["dry-run"] === true &&
    !["fix", "init", "migrate", "preset", "rules"].includes(verb) &&
    !(verb === "doctor" && values.fix === true)
  ) {
    return "--dry-run is only for fix, init, migrate, preset, doctor --fix, and rules adopt.";
  }
  if (values.yes === true && !["init", "preset", "rules"].includes(verb)) {
    return "--yes is only for init, preset adopt, preset eject, and rules adopt.";
  }
  if (values.rule !== undefined && values.migration !== undefined) {
    return "--rule cannot be combined with --migration.";
  }
  if (values.rule !== undefined && verb !== "explain") {
    return "--rule is only for explain.";
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
