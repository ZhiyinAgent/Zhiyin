// Prints a first line, waits until told to go on, then prints a second.
import { existsSync } from "node:fs";

process.stdout.write("first\n");
const go = process.argv[2];
const timer = setInterval(() => {
  if (!existsSync(go)) return;
  clearInterval(timer);
  process.stdout.write("second\n");
}, 20);
