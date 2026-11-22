import path from "node:path";

import { z } from "zod";

import type { Fact, FactReport } from "../../contracts/facts.ts";
import { exec } from "../exec.ts";
import { discoveryLimit, staticOptions } from "./fact-config.ts";
import type { FormatterOptions } from "./fact-config.ts";

const ReportSchema = z.object({
  config: z.object({
    bunfig: z.string().nullable(),
    path: z.string().nullable(),
  }),
});
const CONFIG_READ =
  "Bun selected the config file, but does not expose its resolved printWidth. The value was read from that config.";

interface Context {
  readonly binary: string;
  readonly root: string;
  readonly bunfig?: string;
  readonly global?: FormatterOptions;
}

const hasOverrides = (options: FormatterOptions | undefined) =>
  (options?.overrides?.length ?? 0) > 0;

const forPath = async (
  context: Context,
  file: string,
  selectedByDirectory: Map<string, string>
) => {
  const { binary, root, global, bunfig } = context;
  const directory = path.dirname(file);
  let selected = selectedByDirectory.get(directory);
  if (selected === undefined) {
    const found = await exec(
      [
        binary,
        "fmt",
        "--no-script",
        `--find-config-path=${path.join(root, file)}`,
      ],
      root
    );
    if (
      found.exitCode !== 0 &&
      !found.stderr.includes("Can not find configure file")
    ) {
      throw new Error(found.stderr.trim() || "bun fmt config discovery failed");
    }
    selected = found.exitCode === 0 ? found.stdout.trim() : "";
    selectedByDirectory.set(directory, selected);
  }
  let source = selected === "" ? undefined : path.resolve(root, selected);
  let options: FormatterOptions | undefined;
  const facts: Fact[] = [];
  try {
    options = source === undefined ? undefined : await staticOptions(source);
  } catch (error) {
    return {
      facts,
      limitations: [
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (hasOverrides(global) || hasOverrides(options)) {
    return {
      facts,
      limitations: [
        `${file}: Bun does not expose resolved per-file formatter overrides, so line_width was not compared`,
      ],
    };
  }
  let width = options?.printWidth;
  let key = "printWidth";
  if (global?.printWidth !== undefined) {
    width = global.printWidth;
    source = bunfig;
    key = "fmt.printWidth";
  }
  if (width !== undefined && source !== undefined) {
    facts.push({
      evidence: "config-read",
      file: path.relative(root, source),
      key,
      name: "line_width",
      path: file,
      value: width,
    });
    return { facts, limitations: [CONFIG_READ] };
  }
  return {
    facts,
    limitations: [
      `${file}: Bun does not expose a resolved line_width from inherited editor settings or defaults`,
    ],
  };
};

/** Native discovery chooses the active config. No authored code is imported. */
export const readFacts = async (
  command: string,
  root: string,
  paths: readonly string[] = [],
  compatibilityConfigs: readonly string[] = []
): Promise<FactReport> => {
  if (paths.length === 0) {
    return {
      facts: [],
      limitations: [
        "No selected formatter path was available for config observation",
      ],
      ok: true,
    };
  }
  const binary = Bun.which(command) ?? command;
  try {
    const limitsByDirectory = new Map<string, string | undefined>();
    const limitations = new Set<string>();
    const safe: string[] = [];
    for (const file of paths) {
      const directory = path.dirname(file);
      if (!limitsByDirectory.has(directory)) {
        // eslint-disable-next-line no-await-in-loop -- preflight each scope before any native query
        const limit = await discoveryLimit(root, [file], compatibilityConfigs);
        limitsByDirectory.set(directory, limit);
      }
      const limit = limitsByDirectory.get(directory);
      if (limit === undefined) {
        safe.push(file);
      } else {
        limitations.add(limit);
      }
    }
    if (safe.length === 0) {
      return { facts: [], limitations: [...limitations], ok: true };
    }
    const doctor = await exec(
      [
        binary,
        "fmt",
        "--no-script",
        "--doctor",
        "--format=json",
        "--",
        ...safe.slice(0, 1).map((file) => `./${file}`),
      ],
      root
    );
    if (doctor.exitCode !== 0) {
      return {
        ok: false,
        reason:
          doctor.stderr.trim() ||
          "bun fmt could not describe its active configs",
      };
    }
    const { config } = ReportSchema.parse(JSON.parse(doctor.stdout));
    const bunfig =
      config.bunfig === null ? undefined : path.resolve(root, config.bunfig);
    const global =
      bunfig === undefined ? undefined : await staticOptions(bunfig);
    const reports = [];
    const selectedByDirectory = new Map<string, string>();
    for (const file of safe) {
      // eslint-disable-next-line no-await-in-loop -- avoid one process per selected file running at once
      const report = await forPath(
        {
          binary,
          ...(bunfig === undefined ? {} : { bunfig }),
          ...(global === undefined ? {} : { global }),
          root,
        },
        file,
        selectedByDirectory
      );
      reports.push(report);
    }
    return {
      facts: reports.flatMap((report) => report.facts),
      limitations: [
        ...new Set([
          ...limitations,
          ...reports.flatMap((report) => report.limitations),
        ]),
      ],
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};
