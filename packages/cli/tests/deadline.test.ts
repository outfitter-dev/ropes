import { expect, test } from "bun:test";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";
import { ADVISORY, BASE, BLOCKING, RULE } from "./enforcement-fixture.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const BEFORE = "2099-01-31T23:59:59.999Z";
const DEADLINE = "2099-02-01T00:00:00.000Z";
const AFTER = "2099-02-01T00:00:00.001Z";
const KEY = `rules.enforcement.${RULE}`;
const SCHEDULE = `${BASE}
[rules.enforcement]
"${RULE}" = "2099-02-01"
`;

test("a scheduled rule changes verdict at midnight UTC on unchanged source", async () => {
  if (Bun.which("ast-grep") === null) {
    console.warn(
      "skipped: ast-grep is not on PATH, so the deadline proof did not run"
    );
    return;
  }
  await withFixture(async ({ main, emptyPath }) => {
    const config = path.join(main.root, "rope.toml");
    await Promise.all([
      Bun.write(config, SCHEDULE),
      Bun.write(path.join(main.root, ADVISORY), "{}\n"),
    ]);
    const files = await main.files();
    const run = (args: readonly string[], toolPath?: string) =>
      runEntry(ROPE, args, main.root, toolPath);
    const checkAt = (at: string, toolPath?: string) =>
      run(["check", ADVISORY, "--at", at, "--json"], toolPath);
    const early = await checkAt(BEFORE);
    expect(early.exitCode).toBe(0);
    const observed = parseResult(json(early));
    if (!observed.ok) {
      throw new Error(JSON.stringify(observed.error));
    }
    const { plan } = observed.value;
    expect(plan.evaluation).toEqual({
      at: BEFORE,
      nextTransitionAt: DEADLINE,
      simulated: true,
    });
    expect(plan.paths[0]?.policy).toContainEqual({
      blockingAt: DEADLINE,
      key: KEY,
      source: { file: "rope.toml", key: KEY, kind: "file" },
      value: "advisory",
    });
    expect(plan.rules?.find(({ name }) => name === "config")).toMatchObject({
      name: "config",
      named: { key: "rules.packs" },
    });
    expect(
      observed.value.steps.flatMap(({ findings }) => findings)
    ).toMatchObject([
      { enforcement: { level: "advisory" }, rule: RULE, severity: "error" },
    ]);
    expect(parseResult({ ...observed.value, schemaVersion: 2 })).toEqual({
      error: { found: 2, kind: "unknown-version" },
      ok: false,
    });
    expect(
      json(await run(["explain", ADVISORY, "--at", BEFORE, "--json"]))
    ).toEqual(plan);
    expect(
      json(await main.rope(["explain", ADVISORY, "--at", BEFORE, "--json"]))
    ).toEqual(plan);
    expect(json(await checkAt(BEFORE))).toEqual(observed.value);
    const text = await run(["check", ADVISORY, "--at", BEFORE]);
    expect(text.stdout).toContain(`Simulated evaluation at ${BEFORE}`);
    expect(text.stdout).toContain(`Next enforcement transition: ${DEADLINE}`);
    const blockingRuns = await Promise.all(
      [DEADLINE, AFTER].map(async (instant) => ({
        instant,
        ran: await checkAt(instant),
      }))
    );
    for (const { instant, ran: blocking } of blockingRuns) {
      expect(blocking.exitCode).toBe(1);
      expect(json(blocking)).toMatchObject({
        outcome: "findings",
        plan: { evaluation: { at: instant, simulated: true } },
        steps: [{ findings: [{ enforcement: { level: "blocking" } }] }],
      });
      const parsed = parseResult(json(blocking));
      expect(
        parsed.ok && parsed.value.plan.evaluation?.nextTransitionAt
      ).toBeUndefined();
    }
    const live = parseResult(json(await run(["check", ADVISORY, "--json"])));
    expect(live.ok && live.value.plan.evaluation).toMatchObject({
      simulated: false,
    });
    const unavailable = await checkAt(BEFORE, emptyPath);
    expect(unavailable.exitCode).toBe(2);
    expect(json(unavailable)).toMatchObject({ outcome: "incomplete" });
    const noZone = await checkAt("2099-02-01T00:00:00");
    expect(noZone.stderr).toContain("Use a UTC instant");
    const bare = await main.rope(["check", ADVISORY, "--json", "--at"]);
    expect(bare.exitCode).toBe(2);
    expect(bare.stderr).toContain("Option '--at <value>' argument missing");
    const write = await run(["fix", ADVISORY, "--at", BEFORE]);
    expect(write.exitCode).toBe(2);
    expect(await main.files()).toEqual(files);
  });
}, 30_000);

test("only the selected, applicable rule contributes a deadline", async () => {
  await withFixture(async ({ main }) => {
    const config = path.join(main.root, "rope.toml");
    const managed = ".ropes/configs/tsconfig.json";
    const unrelated = "package.json";
    await Promise.all(
      [ADVISORY, BLOCKING, managed, unrelated].map((file) =>
        Bun.write(path.join(main.root, file), "{}\n")
      )
    );
    const explain = (files: readonly string[]) =>
      runEntry(
        ROPE,
        ["explain", ...files, "--at", BEFORE, "--json"],
        main.root
      );
    await Bun.write(
      config,
      `${SCHEDULE.replace(
        'include = ["**/tsconfig.json"]',
        'include = ["**/tsconfig.json", "package.json"]'
      ).replace("pilot = 0", 'pilot = 0\nexclude = ["packages/blocking/**"]')}
[[overrides]]
paths = ["packages/advisory/**"]
[overrides.rules.enforcement]
"${RULE}" = "2099-03-01"
`
    );
    const selected = parsePlan(
      json(await explain([ADVISORY, BLOCKING, managed, unrelated]))
    );
    if (!selected.ok) {
      throw new Error(JSON.stringify(selected.error));
    }
    expect(selected.value.evaluation?.nextTransitionAt).toBe(
      "2099-03-01T00:00:00.000Z"
    );
    const overridden = selected.value.paths.find(
      (entry) => entry.path === ADVISORY
    );
    expect(overridden?.policy.find(({ key }) => key === KEY)).toMatchObject({
      blockingAt: "2099-03-01T00:00:00.000Z",
      key: KEY,
      source: { key: `overrides.0.${KEY}` },
    });
    const excluded = selected.value.paths.find(
      (entry) => entry.path === BLOCKING
    );
    expect(excluded?.skipped).toMatchObject({ reason: "excluded" });
    const noActiveDeadline = async (files: readonly string[]) => {
      const ran = await explain(files);
      expect(ran.exitCode).toBe(0);
      expect(json(ran)).toMatchObject({
        evaluation: { at: BEFORE, simulated: true },
      });
      expect(ran.stdout).not.toContain("nextTransitionAt");
      expect(ran.stdout).not.toContain("blockingAt");
    };
    await noActiveDeadline([BLOCKING, managed, unrelated]);
    await Bun.write(
      config,
      SCHEDULE.replace(
        'packs = ["config"]',
        `packs = ["config"]\noff = ["${RULE}"]`
      )
    );
    await noActiveDeadline([ADVISORY]);
    const disabled = parsePlan(json(await explain([ADVISORY])));
    if (!disabled.ok) {
      throw new Error(JSON.stringify(disabled.error));
    }
    expect(
      disabled.value.rules?.find(({ name }) => name === "config")
    ).toMatchObject({
      rules: [{ id: RULE, off: { key: "rules.off" } }],
    });
    await Bun.write(
      config,
      SCHEDULE.replace('packs = ["config"]', "packs = []")
    );
    await noActiveDeadline([ADVISORY]);
    await Bun.write(config, SCHEDULE.replace("2099-02-01", "2099-02-29"));
    const malformed = await explain([ADVISORY]);
    expect(malformed.exitCode).toBe(2);
    expect(malformed.stderr).toContain("quoted UTC date in YYYY-MM-DD form");
    await Bun.write(config, `${SCHEDULE}"${RULE}" = "blocking"\n`);
    const duplicate = await explain([ADVISORY]);
    expect(duplicate.exitCode).toBe(2);
  });
}, 30_000);

test("the setup report omits deadlines for content steps", async () => {
  await withFixture(async ({ main }) => {
    await Promise.all([
      Bun.write(
        path.join(main.root, "rope.toml"),
        `${SCHEDULE}\n[typescript]\npreset = true\n`
      ),
      Bun.write(path.join(main.root, "tsconfig.json"), "{}\n"),
    ]);
    const explain = await main.rope([
      "explain",
      "tsconfig.json",
      "--json",
      "--at",
      BEFORE,
    ]);
    expect(explain.stdout).toContain("nextTransitionAt");
    const doctor = await main.rope(["doctor", "--json"]);
    expect(json(doctor)).toHaveProperty("result.plan.paths");
    expect(doctor.stdout).toContain('"tsconfig.json"');
    expect(doctor.stdout).not.toContain('"evaluation"');
    expect(doctor.stdout).not.toContain('"blockingAt"');
  });
}, 30_000);
