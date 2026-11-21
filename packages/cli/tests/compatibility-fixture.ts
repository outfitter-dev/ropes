import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RULE = "typescript-api/removed-map";
export const CONFIG = `pilot = 0
include = ["**/*.ts"]
exclude = ["**/node_modules/**"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[rules]
enabled = true
packs = ["typescript-api"]
`;
export const BEFORE =
  'import type { Map as LegacyMap } from "typescript";\nexport type Legacy = LegacyMap<string>;\n';
export const AFTER = "export type Current = Map<string, string>;\n";

/** Official, exact API declarations installed from the committed lockfile. */
export const apiPackage = async (directory: string, version: "4-9" | "5-0") => {
  const source = path.dirname(
    fileURLToPath(import.meta.resolve(`typescript-${version}/package.json`))
  );
  const target = path.join(directory, "node_modules/typescript");
  await mkdir(path.join(target, "lib"), { recursive: true });
  await Promise.all([
    copyFile(
      path.join(source, "package.json"),
      path.join(target, "package.json")
    ),
    copyFile(
      path.join(source, "lib/typescript.d.ts"),
      path.join(target, "lib/typescript.d.ts")
    ),
  ]);
};

export const packageAt = async (
  root: string,
  name: string,
  range: string | null,
  version: "4-9" | "5-0" = "5-0"
) => {
  const directory = path.join(root, "packages", name);
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({
      name,
      ...(range === null ? {} : { peerDependencies: { typescript: range } }),
    })
  );
  await Bun.write(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "esnext",
        moduleResolution: "bundler",
        skipLibCheck: true,
        strict: true,
      },
    })
  );
  await apiPackage(directory, version);
  return directory;
};
