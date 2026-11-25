import { CONFIG_MIGRATION_GUIDE } from "../config/legacy.ts";
import type { ConfigError } from "../contracts/config.ts";
import type { RootError } from "../contracts/root.ts";

export const describeConfigError = (error: ConfigError): string => {
  switch (error.kind) {
    case "legacy": {
      return `${error.file} uses retired Cinch configuration. ${error.replacement} Guide: ${CONFIG_MIGRATION_GUIDE}`;
    }
    case "unreadable": {
      return `${error.file} could not be read: ${error.message}`;
    }
    case "malformed": {
      return `${error.file} is not valid TOML: ${error.message}`;
    }
    case "missing-version": {
      return `${error.file} does not state a pilot version. Add \`pilot = 0\`.`;
    }
    case "unknown-version": {
      return `${error.file} states pilot version ${JSON.stringify(error.found)}, which this build does not know.`;
    }
    case "invalid": {
      return `${error.file} is not a valid config: ${error.issues.join("; ")}`;
    }
    case "conflict": {
      return `${error.files.join(" and ")} configure the same run. Keep one.`;
    }
    default: {
      return error satisfies never;
    }
  }
};

/** One line a person can act on. Every kind is spelled out, none falls through. */
export const describeRootError = (error: RootError): string => {
  switch (error.kind) {
    case "configuration": {
      return describeConfigError(error.error);
    }
    case "no-repo": {
      return `${error.from} is not inside a git or jj repository.`;
    }
    case "outside-root": {
      return `${error.path} is outside the root ${error.root}.`;
    }
    default: {
      return error satisfies never;
    }
  }
};
