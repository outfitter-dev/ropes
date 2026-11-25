import path from "node:path";

/**
 * A directory holding one of these is a package. The list is the manifests
 * of the ecosystems Ropes has engines for or expects to.
 */
const MANIFESTS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

/** Every directory above a root-relative path, nearest last. Not the root. */
const above = (file: string): string[] => {
  const parts = file.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
};

const isPackage = async (root: string, directory: string): Promise<boolean> => {
  const found = await Promise.all(
    MANIFESTS.map((manifest) =>
      Bun.file(path.join(root, directory, manifest)).exists()
    )
  );
  return found.some(Boolean);
};

/**
 * The package directories above the given root-relative paths. Only the
 * directories on the way to a selected file are looked at, so a large
 * repository costs no more than its selection. The root is never listed:
 * a file with no package above it belongs to the workspace.
 */
export const packagesAbove = async (
  root: string,
  paths: readonly string[]
): Promise<string[]> => {
  const directories = [...new Set(paths.flatMap(above))].toSorted();
  const kept = await Promise.all(
    directories.map((directory) => isPackage(root, directory))
  );
  return directories.filter((_, index) => kept[index] === true);
};
