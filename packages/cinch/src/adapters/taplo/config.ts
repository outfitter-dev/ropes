import { constants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const readableConfig = async (file: string): Promise<string> => {
  const info = await stat(file);
  if (!info.isFile()) {
    throw new Error(`Taplo config is not a file: ${file}`);
  }
  await access(file, constants.R_OK);
  return file;
};

/** Native Taplo searches the working directory, then its ancestors. */
export const nativeConfigArgs = async (root: string): Promise<string[]> => {
  const configured = Bun.env.TAPLO_CONFIG;
  if (configured !== undefined) {
    if (configured === "") {
      throw new Error("TAPLO_CONFIG is empty");
    }
    return ["--config", await readableConfig(path.resolve(root, configured))];
  }
  let directory = await realpath(root);
  while (true) {
    // eslint-disable-next-line no-await-in-loop -- stop at the nearest native config
    const entries = await readdir(directory);
    const configs = entries.filter(
      (name) => name === ".taplo.toml" || name === "taplo.toml"
    );
    // Native 0.10 returns the first directory entry, so two names have no fixed precedence.
    if (configs.length > 1) {
      throw new Error(
        `Cannot confirm native Taplo config precedence in ${directory}`
      );
    }
    const [selected] = configs;
    if (selected !== undefined) {
      // eslint-disable-next-line no-await-in-loop -- return after reading the selected config
      return ["--config", await readableConfig(path.join(directory, selected))];
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return ["--no-auto-config"];
    }
    directory = parent;
  }
};
