import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  CONFIG_PATH,
  PRESET_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { createCommands } from "../src/commands/registry.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";

const EXTENDS = `extends = ${JSON.stringify(PRESET_PATH)}\n`;

const ready = Bun.which("rumdl") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!ready) {
      console.warn(`skipped: rumdl is not on PATH, so "${name}" did not run`);
      return;
    }
    await body();
  });
};

const inRoot = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-mig-")));
  try {
    await mkdir(path.join(root, ".git"));
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const preset = rumdlPresetAdapter();
const written = (root: string): Promise<string> =>
  Bun.file(path.join(root, CONFIG_PATH)).text();

/** One choice the preset already makes, one alias, and one that differs. */
const RULES = {
  MD007: { indent: 4 },
  MD024: { siblings_only: true },
  "no-inline-html": false,
};
const JSON_RULES = JSON.stringify(RULES);
const YAML_RULES =
  "MD007:\n  indent: 4\nMD024:\n  siblings_only: true\nno-inline-html: false\n";
const indented = (text: string): string =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const FORMS: readonly (readonly [string, string])[] = [
  [".markdownlint.json", JSON_RULES],
  [".markdownlint.jsonc", `// Rules.\n${JSON_RULES}`],
  [".markdownlint.yaml", YAML_RULES],
  [".markdownlint.yml", YAML_RULES],
  [".markdownlint-cli2.jsonc", `{ "config": ${JSON_RULES} }`],
  [".markdownlint-cli2.yaml", `config:\n${indented(YAML_RULES)}\n`],
  ["package.json", `{ "markdownlint-cli2": { "config": ${JSON_RULES} } }`],
];

for (const [name, text] of FORMS) {
  withEngine(`${name} migrates to only the choice that differs`, async () => {
    await inRoot({ [name]: text }, async (root) => {
      const outcome = await preset.fix({ path: CONFIG_PATH, root });
      expect(outcome.status).toBe("fixed");
      expect(await written(root)).toBe(
        [
          EXTENDS,
          `# Carried over from ${name} by Cinch.`,
          "# Only what differs from the Markdown standard is here.",
          "[MD007]",
          "indent = 4",
          "",
        ].join("\n")
      );
    });
  });
}

withEngine(
  "a config equal to the preset migrates to the bare line",
  async () => {
    const rules = {
      MD003: { style: "atx" },
      MD004: { style: "dash" },
      MD007: { indent: 2 },
      MD013: false,
      "no-inline-html": false,
      "ul-style": { style: "dash" },
    };
    const files = { ".markdownlint.json": JSON.stringify(rules) };
    await inRoot(files, async (root) => {
      await preset.fix({ path: CONFIG_PATH, root });
      expect(await written(root)).toBe(EXTENDS);
    });
  }
);

withEngine("the migrated config is one the engine accepts", async () => {
  const rules = {
    MD001: false,
    MD013: { line_length: 120 },
    "my-rule": true,
  };
  const files = {
    ".markdownlint.json": JSON.stringify(rules),
    "a.md": "# T\n\nText.\n",
  };
  await inRoot(files, async (root) => {
    await preset.fix({ path: PRESET_PATH, root });
    await preset.fix({ path: CONFIG_PATH, root });
    const text = await written(root);
    expect(text).toContain(
      'disable = ["MD001", "MD026", "MD033", "MD036", "MD041"]'
    );
    expect(text).toContain("[MD013]\nline-length = 120");
    expect(text).toContain("# - `my-rule` is not a rule the new linter has.");
    const linter = adaptersFor({}).find(
      (adapter) => adapter.descriptor.id === "rumdl"
    );
    const outcome = await linter?.check({ path: "a.md", root });
    expect(outcome?.status).toBe("passed");
  });
});

withEngine("a second run after migrating changes nothing", async () => {
  const files = { ".markdownlint.json": JSON_RULES };
  await inRoot(files, async (root) => {
    await preset.fix({ path: CONFIG_PATH, root });
    const first = await written(root);
    const again = await preset.fix({ path: CONFIG_PATH, root });
    expect(again.status).toBe("passed");
    expect(await written(root)).toBe(first);
  });
});

withEngine("init previews the migration and writes nothing", async () => {
  const commands = createCommands({ adapters: adaptersFor });
  const files = { ".markdownlint.json": JSON_RULES };
  await inRoot(files, async (root) => {
    const response = await commands.init?.({
      cwd: root,
      json: true,
      paths: [],
    });
    const report = FixReportSchema.parse(
      JSON.parse(response?.output ?? "null")
    );
    expect(report.dryRun).toBe(true);
    expect(report.diff).toContain(
      "+# Carried over from .markdownlint.json by Cinch."
    );
    expect(report.diff).toContain("+indent = 4");
    expect(await Bun.file(path.join(root, CONFIG_PATH)).exists()).toBe(false);
  });
});

test("a script config blocks the new file and names the script", async () => {
  const files = { ".markdownlint.cjs": "module.exports = {};" };
  await inRoot(files, async (root) => {
    const outcome = await preset.fix({ path: CONFIG_PATH, root });
    expect(outcome.status).toBe("findings");
    expect(outcome.findings[0]).toMatchObject({ fixable: false });
    expect(outcome.findings[0]?.message).toContain(".markdownlint.cjs");
    expect(await Bun.file(path.join(root, CONFIG_PATH)).exists()).toBe(false);
  });
});

const lint = async (root: string, file: string) => {
  const linter = adaptersFor({}).find(
    (adapter) => adapter.descriptor.id === "rumdl"
  );
  const outcome = await linter?.check({ path: file, root });
  return outcome?.status;
};

withEngine("an option the engine renames is carried over", async () => {
  const rules = { MD013: { line_length: 100, stern: true } };
  const files = { ".markdownlint.json": JSON.stringify(rules) };
  await inRoot(files, async (root) => {
    await preset.fix({ path: CONFIG_PATH, root });
    const text = await written(root);
    expect(text).toContain("[MD013]\nline-length = 100\nstrict = true");
    expect(text).not.toContain("Not carried over");
  });
});

withEngine("the last entry for a rule decides whether it runs", async () => {
  const text = '{ "MD013": true, "line-length": false }';
  await inRoot({ ".markdownlint.json": text }, async (root) => {
    await preset.fix({ path: CONFIG_PATH, root });
    expect(await written(root)).toBe(EXTENDS);
  });
});

/** A heading with nothing under it, which only a rule the preset adds reports. */
const EMPTY_SECTION = "# T\n\n## Empty\n\n## Next\n\nBody.\n";

withEngine(
  "a list of the only rules to run keeps the preset's out",
  async () => {
    const files = {
      ".markdownlint.json": '{ "default": false, "MD001": true }',
      "a.md": EMPTY_SECTION,
      "b.md": "# T\n\n### Skipped a level\n\nBody.\n",
    };
    await inRoot(files, async (root) => {
      await preset.fix({ path: PRESET_PATH, root });
      await preset.fix({ path: CONFIG_PATH, root });
      expect(await written(root)).toContain('enable = ["MD001"]');
      expect(await lint(root, "a.md")).toBe("passed");
      expect(await lint(root, "b.md")).toBe("findings");
    });
  }
);

withEngine(
  "a config that switches every rule off reports nothing",
  async () => {
    const files = {
      ".markdownlint.json": '{ "default": false }',
      "a.md": `${EMPTY_SECTION}\n### Skipped a level\n`,
    };
    await inRoot(files, async (root) => {
      await preset.fix({ path: PRESET_PATH, root });
      await preset.fix({ path: CONFIG_PATH, root });
      expect(await written(root)).toContain("enable = []");
      expect(await lint(root, "a.md")).toBe("passed");
    });
  }
);

test("without the engine the step is incomplete, and nothing is written", async () => {
  const absent = rumdlPresetAdapter({ command: "cinch-test-no-such-rumdl" });
  await inRoot({ ".markdownlint.json": JSON_RULES }, async (root) => {
    const outcome = await absent.fix({ path: CONFIG_PATH, root });
    expect(outcome.status).toBe("incomplete");
    expect(outcome.findings).toEqual([]);
    expect(outcome.status === "incomplete" ? outcome.reason : "").toContain(
      "cinch-test-no-such-rumdl"
    );
    expect(await Bun.file(path.join(root, CONFIG_PATH)).exists()).toBe(false);
  });
});

withEngine(
  "`extends` in the old config does not stop the migration",
  async () => {
    const rules = { MD007: { indent: 4 }, extends: "../shared/base.json" };
    const files = { ".markdownlint.json": JSON.stringify(rules) };
    await inRoot(files, async (root) => {
      const outcome = await preset.fix({ path: CONFIG_PATH, root });
      expect(outcome.status).toBe("fixed");
      const text = await written(root);
      expect(text).toContain("[MD007]\nindent = 4");
      expect(text).toContain("`extends` names another config");
    });
  }
);
