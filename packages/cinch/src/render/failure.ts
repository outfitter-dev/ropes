import type { Failure } from "../contracts/failure.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";

const PREFIX = /^cinch: /gmu;

/** One line of JSON for stderr. The `cinch: ` prefix is for people only. */
export const renderFailureJson = (message: string): string => {
  const failure: Failure = {
    error: { message: message.replaceAll(PREFIX, "") },
    schemaVersion: SCHEMA_VERSION,
  };
  return JSON.stringify(failure);
};
