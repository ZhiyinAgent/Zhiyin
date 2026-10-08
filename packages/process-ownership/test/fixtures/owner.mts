// A separate owning process, so the test can kill it abruptly. Contains a
// child that starts a detached grandchild, then does nothing: no exit handler,
// no cleanup, nothing that could tidy up on the way out.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { register } from "node:module";

// Imported once the hook is registered, so the module's own sibling imports
// resolve under type stripping.
register("./source-imports.mjs", import.meta.url);
const { openProcessContainer } = await import("../../src/windows.ts");

const here = dirname(fileURLToPath(import.meta.url));
const directory = process.argv[2];
const container = openProcessContainer();
const child = spawn(process.execPath, [join(here, "child.mjs"), directory], {
  stdio: "ignore",
  windowsHide: true,
});
if (child.pid === undefined) throw new Error("no child pid");
container.contain(child.pid);
writeFileSync(join(directory, "owner.pid"), String(process.pid));
setInterval(() => {}, 1000);
