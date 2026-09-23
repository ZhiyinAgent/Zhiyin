// Prints without end, as a stuck build or a runaway log would. Its pid is
// written first so a test can ask the system whether it is still alive.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

writeFileSync(join(process.argv[2], "flood.pid"), String(process.pid));
const chunk = Buffer.alloc(1024 * 1024, "x");
const write = () => {
  while (process.stdout.write(chunk));
  process.stdout.once("drain", write);
};
write();
