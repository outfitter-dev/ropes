import type { Adapter, FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { SUPPORTED_RANGE } from "./adapter.ts";
import { apiProblem } from "./api-package.ts";
import { checkBatch } from "./run.ts";

const RULE = "typescript-api/removed-map";
const REMOVED = /^Module '"typescript"' has no exported member 'Map'\.$/u;

/** Direct imports retain the compiler's explicit module and member identity. */
const mapped = (outcome: FileOutcome): FileOutcome => {
  let unknown = false;
  const findings = outcome.findings.map((finding) => {
    if (finding.rule === "TS2305" && REMOVED.test(finding.message)) {
      return { ...finding, nativeRule: finding.rule, rule: RULE };
    }
    unknown = true;
    return finding;
  });
  return unknown
    ? {
        ...outcome,
        findings,
        reason:
          "the compiler reported diagnostics outside the direct TypeScript Map import pilot",
        status: "incomplete",
      }
    : { ...outcome, findings };
};

const run = async (input: StepInput) => {
  const problem = await apiProblem(input);
  if (problem !== undefined) {
    return allIncomplete(input, problem);
  }
  const binary = Bun.which("bun");
  if (binary === null) {
    return allIncomplete(input, "bun is not on PATH");
  }
  const checked = await checkBatch(binary, input);
  return checked.map(mapped);
};

/** A narrow compiler-native compatibility proof, adopted as its own pack. */
export const compilerApiAdapter = (version?: string): Adapter => ({
  check: run,
  descriptor: {
    ...heldTo(version, SUPPORTED_RANGE),
    enabledBy: "rules.enabled",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    id: "typescript-api",
    optIn: true,
    packs: [
      {
        about: "Direct imports of TypeScript compiler APIs removed in 5.0.",
        name: "typescript-api",
        relevant: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
        rules: [RULE],
      },
    ],
    platforms: ["darwin", "linux", "win32"],
    target: { atLeast: "5.0.0", dependency: "typescript" },
    tool: "bun",
    unit: "file",
    writes: false,
  },
  fix: run,
  probe: () => probeOnPath("bun"),
});
