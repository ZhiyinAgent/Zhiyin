// Waits for "go" in its folder, then commits 640 MB in 32 MB buffers and says
// how far it got. A process held to less ends before it can say it finished.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
const wait = setInterval(() => {
  if (!existsSync(join(directory, "go"))) return;
  clearInterval(wait);
  const kept = [];
  for (let index = 0; index < 20; index++)
    kept.push(Buffer.alloc(32 * 1024 * 1024, 1));
  writeFileSync(join(directory, "allocated"), String(kept.length * 32));
  setInterval(() => {}, 1000);
}, 10);
