// A process that quits while it waits for many contained processes to end:
// it launches sleepers, waits on each, says so, then exits with them still
// running. It has to end on its own, without hanging or crashing.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// Imported once the hook is registered, so the module's own sibling imports
// resolve under type stripping.
register("./source-imports.mjs", import.meta.url);
const { openProcessContainer } = await import("../../src/windows.ts");

const here = dirname(fileURLToPath(import.meta.url));
const directory = process.argv[2];
if (directory === undefined) throw new Error("no directory");
const container = openProcessContainer();
const running = Array.from({ length: 8 }, (_, index) =>
  container.launch({
    executable: process.execPath,
    arguments: [join(here, "sleeper.mjs")],
    cwd: directory,
    stdout: join(directory, `stdout-${index}.txt`),
    stderr: join(directory, `stderr-${index}.txt`),
  }),
);
for (const child of running) void child.wait();
writeFileSync(
  join(directory, "sleepers.json"),
  JSON.stringify(running.map((child) => child.pid)),
);
process.exit(0);
