import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = process.argv[2];
const fixtures = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(fixtures, "sleeper.mjs")], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
if (child.pid === undefined) process.exit(2);
child.unref();
writeFileSync(join(directory, "immediate.pid"), String(child.pid));
