import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import startup from "./zhiyin_container.py?raw";

/**
 * What an environment's Python runs as it starts, so its standard library
 * works in the container scripts and package installs run in (ADR 0020). The
 * Python is a file of its own beside this one, bundled with the app as text.
 *
 * Loaded by a path file rather than as `sitecustomize`, because pip builds a
 * source package with a `sitecustomize` of its own, which would hide this one;
 * every path file in the environment's packages still runs.
 */
const files = {
  "zhiyin_container.py": startup,
  "zhiyin_container.pth": "import zhiyin_container\n",
};

/** Puts the startup files in an environment, unless they are there as they are. */
export async function keepStartup(environment: string): Promise<void> {
  const packages = join(environment, "Lib", "site-packages");
  await mkdir(packages, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    const file = join(packages, name);
    if ((await readFile(file, "utf8").catch(() => "")) !== text)
      await writeFile(file, text, "utf8");
  }
}
