// Holds a lock and then does nothing, so the test can kill it outright: no
// exit handler, no release, nothing that could tidy up on the way out.
import { register } from "node:module";

register("./source-imports.mjs", import.meta.url);
const { holdExclusively } = await import("../../src/file-lock.ts");

const attempt = holdExclusively(process.argv[2] as string);
process.stdout.write(
  "held" in attempt ? "held\n" : `refused ${attempt.refused}\n`,
);
setInterval(() => {}, 1000);
