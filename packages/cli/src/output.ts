import { EXIT_CODE } from "@ropes/core";
import { renderFailureJson } from "@ropes/core/render";

export const print = (output: string): void => {
  process.stdout.write(`${output}\n`);
};

export const fail = (message: string, json: boolean): number => {
  // Setup errors join later lines with `cinch: `. Rebrand those as rope.
  const text = json
    ? renderFailureJson(message)
    : `rope: ${message.replaceAll("\ncinch: ", "\nrope: ")}`;
  process.stderr.write(`${text}\n`);
  return EXIT_CODE.incomplete;
};
