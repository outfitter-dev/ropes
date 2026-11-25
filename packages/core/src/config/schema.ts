import { z } from "zod";

import { ConfigFileSchema } from "./parse.ts";

/**
 * The JSON Schema of `cinch.toml`, made from the definition the loader reads
 * with. Draft 7, because that is what TOML tooling validates against.
 * Unstable, like the format it describes.
 */
export const configJsonSchema = (title = "cinch.toml"): unknown =>
  z.toJSONSchema(
    ConfigFileSchema.meta({
      description:
        "The pilot config of Cinch. Unstable: it will change without notice.",
      title,
    }),
    { target: "draft-7" }
  );
