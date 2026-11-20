import { createHash } from "node:crypto";
import { devNull } from "node:os";
import path from "node:path";

import {
  check,
  exitCodeOf,
  explain,
  parseResult,
  saveRepair,
} from "@ropes/core";

import { RATIONALE } from "./trace-fixture.ts";

// A hook's `GIT_DIR` or a developer's Git config must not reach the fixture.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  ),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
};

const directory = process.env.ROPES_REPAIR_DIR;
const baseline = process.env.ROPES_REPAIR_BASELINE;
if (directory === undefined || baseline === undefined) {
  process.exit(0);
}
const event: unknown = JSON.parse(await Bun.stdin.text());
if (
  typeof event !== "object" ||
  event === null ||
  !("hook_event_name" in event) ||
  event.hook_event_name !== "PostToolUse" ||
  !("tool_name" in event) ||
  !["Edit", "Write"].includes(String(event.tool_name)) ||
  !("session_id" in event) ||
  typeof event.session_id !== "string" ||
  !("tool_use_id" in event) ||
  typeof event.tool_use_id !== "string" ||
  !("cwd" in event) ||
  typeof event.cwd !== "string"
) {
  throw new Error("Expected a Claude Code Edit or Write PostToolUse event.");
}
const request = { cwd: event.cwd, paths: [] };
const checked = await check(request);
if (!checked.ok) {
  throw new Error(checked.error);
}
const result = checked.value;
const git = async (...args: string[]): Promise<string> => {
  const child = Bun.spawn(["git", ...args], {
    cwd: result.plan.root,
    env: ENV,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(stderr);
  }
  return stdout;
};
const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
try {
  const original = parseResult(await Bun.file(baseline).json());
  if (!original.ok) {
    throw new Error(JSON.stringify(original.error));
  }
  const explained = await explain(request, true);
  if (!explained.ok) {
    throw new Error(explained.error);
  }
  const config = "cinch.toml";
  const rule = "rules/private-import.yml";
  const tracked = await git("ls-files", "-z");
  const files = tracked.split("\0").filter((file) => file.length > 0);
  const revision = await git("rev-parse", "HEAD");
  const repository = await git("rev-list", "--max-parents=0", "HEAD");
  const recorded = await saveRepair(directory, {
    convention: {
      authored: {
        failing: 'import { PrivateType } from "./private/types";',
        passing: 'import { PrivateType } from "./index";',
        rationale: RATIONALE,
      },
      file: rule,
      hash: hash(await Bun.file(path.join(result.plan.root, rule)).text()),
      rule: "local/private-import",
    },
    edit: {
      baseFiles: Object.fromEntries(
        await Promise.all(
          files.map(async (file): Promise<readonly [string, string]> => [
            file,
            await git("show", `HEAD:${file}`),
          ])
        )
      ),
      baseRevision: revision.trim(),
      patch: await git(
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--binary",
        "HEAD"
      ),
    },
    event: {
      host: "claude-code",
      id: event.tool_use_id,
      session: event.session_id,
    },
    original: original.value,
    policy: {
      file: config,
      hash: hash(await Bun.file(path.join(result.plan.root, config)).text()),
    },
    repository: repository.trim(),
    result,
    tools: explained.value.tools,
  });
  if (!recorded.ok) {
    console.error(`Repair evidence was not saved: ${recorded.error}`);
  }
} catch (error) {
  console.error(`Repair evidence was not saved: ${String(error)}`);
}
console.log(JSON.stringify(result));
process.exitCode = exitCodeOf(result);
