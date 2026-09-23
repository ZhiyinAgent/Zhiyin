// A separate owning process, so the test can kill it abruptly. Contains a
// child that starts a detached grandchild, then does nothing: no exit handler,
// no cleanup, nothing that could tidy up on the way out.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
// The container module itself: run under type stripping, which cannot
// resolve the package entry's `.js` imports of its siblings.
import { openProcessContainer } from "../../src/windows.ts";

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
