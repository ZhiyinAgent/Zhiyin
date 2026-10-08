// Holds a lock and then does nothing, so the test can kill it outright: no
// exit handler, no release, nothing that could tidy up on the way out.
// The lock module itself, not the package entry, whose `.js` imports of its
// siblings type stripping cannot resolve.
import { holdExclusively } from "../../src/file-lock.ts";

const attempt = holdExclusively(process.argv[2] as string);
process.stdout.write(
  "held" in attempt ? "held\n" : `refused ${attempt.refused}\n`,
);
setInterval(() => {}, 1000);
