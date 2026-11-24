import path from "node:path";

const [tool, ...args] = process.argv.slice(2);
const folder = process.env.RELEASE_FIXTURE;
if (folder === undefined) {
  throw new Error("Missing release fixture");
}
const clock = Bun.file(path.join(folder, "clock"));
const now = Number(await clock.text());
const eventFile = Bun.file(path.join(folder, "events"));
const record = async (event: string) =>
  await Bun.write(eventFile, `${await eventFile.text()}${event}\n`);
const packageOf = (value: string) =>
  /@ropes\/(?<name>[^/?]+)/u.exec(decodeURIComponent(value))?.groups?.name;
if (tool === "date") {
  console.log(now);
} else if (tool === "sleep") {
  await Bun.write(clock, String(now + 60));
} else if (tool === "npm") {
  const name = args[1]?.replace(".tgz", "");
  if (name === undefined) {
    throw new Error("Missing package");
  }
  const published = Bun.file(path.join(folder, `published-${name}`));
  if (await published.exists()) {
    throw new Error("Duplicate publish");
  }
  await Bun.write(published, String(now));
  await record(`publish ${name}`);
} else if (tool === "curl") {
  const url = args.find((arg) => arg.startsWith("https://"));
  const name = packageOf(url ?? "");
  if (name === undefined) {
    throw new Error("Missing registry URL");
  }
  const published = Bun.file(path.join(folder, `published-${name}`));
  const exists = await published.exists();
  const elapsed = exists ? now - Number(await published.text()) : -1;
  if (url?.includes("/-/") === true) {
    await record(`archive ${name}`);
    if (!exists || elapsed < Number(process.env.ARCHIVE_DELAY ?? 0)) {
      process.exit(22);
    }
    const destination = args[args.indexOf("-o") + 1];
    if (destination === undefined) {
      throw new Error("Missing download path");
    }
    await Bun.write(
      destination,
      process.env.WRONG_BYTES === "true" ? "wrong bytes" : `approved ${name}`
    );
  } else {
    const version = "0.1.0-canary.4";
    const visible =
      exists && elapsed >= Number(process.env.METADATA_DELAY ?? 0);
    console.log(
      JSON.stringify({
        "dist-tags": {
          canary:
            visible && process.env.WRONG_TAG !== "true"
              ? version
              : "0.1.0-canary.3",
        },
        name: `@ropes/${name}`,
        versions: visible
          ? {
              [version]: {
                dist: {
                  tarball: `https://registry.npmjs.org/@ropes/${name}/-/${name}-${version}.tgz`,
                },
              },
            }
          : {},
      })
    );
  }
} else {
  throw new Error(`Unexpected fixture command ${tool}`);
}
