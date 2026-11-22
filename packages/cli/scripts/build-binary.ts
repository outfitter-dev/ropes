#!/usr/bin/env bun
import { fileURLToPath } from "node:url";

import { buildBinary } from "../../cinch/scripts/compile.ts";

await buildBinary(fileURLToPath(new URL("../src/cli.ts", import.meta.url)));
