// A later app session: confines a program to the folder it is named, then
// runs the reach fixture until it reports what the test waits for, or gives
// up, and prints the last report.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register("./source-imports.mjs", import.meta.url);
const { confine, openProcessContainer } = await import("../../src/index.ts");

const [purpose, home, folder, programs, operations, awaited] =
  process.argv.slice(2);
if (!purpose || !home || !folder || !programs || !operations || !awaited)
  throw new Error(
    "session.mts <purpose> <home> <folder> <programs> <operations> <awaited>",
  );

const confined = await confine({
  purpose,
  home,
  read: [programs],
  write: [folder],
  network: false,
});
const deadline = Date.now() + 20_000;
let report: string;
do {
  const container = openProcessContainer();
  try {
    const child = container.launch({
      executable: join(programs, "node.exe"),
      arguments: [
        "--preserve-symlinks-main",
        "--preserve-symlinks",
        join(programs, "reach.mjs"),
        operations,
      ],
      cwd: programs,
      stdout: join(folder, "..", "session-out.txt"),
      stderr: join(folder, "..", "session-err.txt"),
      confined,
    });
    await child.wait();
  } finally {
    container.close();
  }
  report = readFileSync(join(folder, "..", "session-out.txt"), "utf8");
  if (report === awaited) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
} while (Date.now() < deadline);
process.stdout.write(report);
