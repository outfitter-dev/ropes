import { z } from "zod";

import { ConfigFileSchema } from "./parse.ts";

/**
 * The JSON Schema of `cinch.toml`, made from the definition the loader reads
 * with. Draft 7, because that is what TOML tooling such as Taplo validates
 * against. Unstable, like the format it describes.
 */
export const configJsonSchema = (): unknown =>
  z.toJSONSchema(
    ConfigFileSchema.meta({
      description:
        "The pilot config of Cinch. Unstable: it will change without notice.",
      title: "cinch.toml",
    }),
    { target: "draft-7" }
  );
