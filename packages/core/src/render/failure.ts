import type { Failure } from "../contracts/failure.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";

const PREFIX = /^(?:cinch|rope): /gmu;

/** Serialize a raw operation error without interpreting its authored text. */
export const renderOperationFailureJson = (message: string): string => {
  const failure: Failure = {
    error: { message },
    schemaVersion: SCHEMA_VERSION,
  };
  return JSON.stringify(failure);
};

/** Serialize an internal command-wrapper error with its display prefixes removed. */
export const renderFailureJson = (message: string): string =>
  renderOperationFailureJson(message.replaceAll(PREFIX, ""));
