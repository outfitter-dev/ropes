import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StepOutcome } from "../adapter.ts";
import { exec } from "../exec.ts";
import type { Exit } from "../exec.ts";
import { STANDALONE } from "../shipped-text.ts";
import { configProblem, parseOutput } from "./output.ts";

const WASM_WORKER = "--internal-taplo-wasm";
const WASM_CLI = "@taplo/cli/dist/cli.js";
const RECOVERED =
  "Checked with Taplo WebAssembly 0.9.0 after native Taplo panicked";

// The macOS standalone build can invoke itself as this engine.
declare const CINCH_TAPLO_WORKER: boolean | undefined;
export const startTaploWorker = (
  argv: string[]
): Promise<unknown> | undefined => {
  if (
    typeof CINCH_TAPLO_WORKER !== "boolean" ||
    !CINCH_TAPLO_WORKER ||
    argv[2] !== WASM_WORKER
  ) {
    return undefined;
  }
  argv[1] = "taplo";
  argv.splice(2, 1);
  return import("@taplo/cli/dist/cli.js");
};

export const isMacProxyPanic = ({ exitCode, stderr }: Exit): boolean =>
  process.platform === "darwin" &&
  exitCode === 101 &&
  /panicked at [^\n]*system-configuration-0\.5\.1\/src\/dynamic_store\.rs:/u.test(
    stderr
  ) &&
  stderr.includes("Attempted to create a NULL object.");

// npm can put the bundled CLI's taplo shim on PATH. Skip that exact CLI
// when locating the separately installed native engine.
const isWasmShim = async (file: string): Promise<boolean> => {
  const target = await realpath(file).catch(() => file);
  if (target.endsWith(path.join("@taplo", "cli", "dist", "cli.js"))) {
    return true;
  }
  if (
    process.platform !== "win32" ||
    path.basename(path.dirname(file)) !== ".bin"
  ) {
    return false;
  }
  // Bun's .exe launchers store the script path in a UTF-16LE sidecar.
  // npm's .cmd launchers include the path in the script.
  const bunLauncher = /\.exe$/iu.test(file);
  const shim = Bun.file(bunLauncher ? file.replace(/\.exe$/iu, ".bunx") : file);
  if (shim.size >= 8192) {
    return false;
  }
  const bytes = await shim.arrayBuffer().catch(() => new ArrayBuffer(0));
  const text = new TextDecoder(bunLauncher ? "utf-16le" : "utf-8").decode(
    bytes
  );
  return text.includes(path.join("..", WASM_CLI));
};

export const nativeCommand = async (
  command: string
): Promise<string | null> => {
  const found = Bun.which(command);
  if (command !== "taplo" || found === null || !(await isWasmShim(found))) {
    return found;
  }
  for (const directory of (Bun.env.PATH ?? "").split(path.delimiter)) {
    const candidate = Bun.which(command, { PATH: directory });
    // eslint-disable-next-line no-await-in-loop -- preserve PATH order
    if (candidate !== null && !(await isWasmShim(candidate))) {
      return candidate;
    }
  }
  return null;
};

const collection =
  /^\s*INFO taplo:lint_files:collect_files: found files total=1 excluded=(?<excluded>[01]) cwd=/mu;
const knownFinding =
  /^ERROR taplo:lint_files: invalid file error=(?:syntax errors found|semantic errors found|schema validation failed) path=/mu;

export const recoverTaplo = async (
  root: string,
  relative: string,
  cause: string
): Promise<StepOutcome> => {
  const incomplete = (message: string): StepOutcome => ({
    findings: [],
    reason: `${cause}\nTaplo WebAssembly: ${message.slice(0, 1000)}`,
    status: "incomplete",
  });
  // The WebAssembly CLI uses fast-glob. A literal argument and its one-file
  // count together are evidence that it checked this file.
  const file = path
    .join(root, relative)
    .replaceAll(/[\\*?[\]{}()!+@|]/gu, "\\$&");

  try {
    const command = STANDALONE
      ? WASM_WORKER
      : fileURLToPath(import.meta.resolve(WASM_CLI));
    const { exitCode, stderr } = await exec(
      [process.execPath, command, "lint", "--colors", "never", "--", file],
      root,
      { RUST_LOG: "taplo=info" }
    );
    const config = configProblem(stderr);
    if (config !== undefined) {
      return incomplete(`could not use its own config: ${config}`);
    }
    const selection = collection.exec(stderr)?.groups?.excluded;
    if (selection === undefined) {
      return incomplete("did not confirm that it read the selected file");
    }
    if (selection === "1") {
      return incomplete("did not read the file. Its config excluded it");
    }
    if (exitCode !== 0 && (exitCode !== 1 || !knownFinding.test(stderr))) {
      const detail = stderr
        .split("\n")
        .find((line) => /^\s*ERROR\s/u.test(line));
      return incomplete(detail?.trim() ?? `unexpected exit ${exitCode}`);
    }
    const warning = /^\s*WARN .*$/mu.exec(stderr)?.[0];
    if (warning !== undefined) {
      return incomplete(warning.trim());
    }
    const parsed = parseOutput(stderr, { path: relative, source: "taplo" });
    if (!parsed.ok) {
      return incomplete(parsed.message);
    }
    const hasFindings = parsed.findings.length > 0;
    if ((exitCode === 1) !== hasFindings) {
      return incomplete(
        `exited ${exitCode} and reported ${parsed.findings.length} problems`
      );
    }
    return {
      findings: parsed.findings,
      reason: RECOVERED,
      status: hasFindings ? "findings" : "passed",
    };
  } catch (error) {
    return incomplete(error instanceof Error ? error.message : String(error));
  }
};
