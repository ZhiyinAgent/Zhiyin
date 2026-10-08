// Waits until told, then starts a DETACHED grandchild and records its pid.
// Detached so that nothing but real containment could reach it.
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const directory = process.argv[2];
const go = join(directory, "go");

const timer = setInterval(() => {
  if (!existsSync(go)) return;
  clearInterval(timer);
  const grandchild = spawn(process.execPath, [join(here, "sleeper.mjs")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  grandchild.unref();
  writeFileSync(join(directory, "grandchild.pid"), String(grandchild.pid));
}, 20);

writeFileSync(join(directory, "child.pid"), String(process.pid));
setInterval(() => {}, 1000);
