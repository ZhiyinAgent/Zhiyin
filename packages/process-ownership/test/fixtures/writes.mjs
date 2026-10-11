// Tries to write each file it is named, then to read it, and reports what
// Windows let it do.
import { readFileSync, writeFileSync } from "node:fs";

const attempt = (action) => {
  try {
    return action() ?? "done";
  } catch (error) {
    return error.code ?? String(error);
  }
};

process.stdout.write(
  JSON.stringify(
    process.argv.slice(2).map((path) => ({
      wrote: attempt(() => writeFileSync(path, "written at low integrity")),
      read: attempt(() => readFileSync(path, "utf8")),
    })),
  ),
);
