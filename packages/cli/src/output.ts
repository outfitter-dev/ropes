import { EXIT_CODE } from "@ropes/core";
import { renderOperationFailureJson } from "@ropes/core/render";

export const print = (output: string): void => {
  process.stdout.write(`${output}\n`);
};

export const fail = (message: string, json: boolean): number => {
  const text = json ? renderOperationFailureJson(message) : `rope: ${message}`;
  process.stderr.write(`${text}\n`);
  return EXIT_CODE.incomplete;
};
