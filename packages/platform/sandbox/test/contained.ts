/**
 * A program in a real app container, as Zhiyin's sandbox starts one, that
 * does file operations in a folder it is given and times each: for the
 * tests of packages above that watch what a contained program does to files.
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  confine,
  forgetConfinement,
  openProcessContainer,
  type Confined,
} from "../src/index.js";
import type { TemporaryFolders } from "@zhiyin/test-support";

const timed = String.raw`
import { writeFileSync, renameSync, rmSync, readFileSync, statSync, utimesSync, openSync, writeSync, closeSync } from "node:fs";
const out = [];
for (const [op, a, b] of JSON.parse(process.argv[2])) {
  const start = Date.now();
  let result = "done";
  try {
    if (op === "write") writeFileSync(a, "written in the container");
    else if (op === "rename") renameSync(a, b);
    else if (op === "delete") rmSync(a);
    else if (op === "read") result = readFileSync(a).length;
    else if (op === "patch") {
      // A mebibyte at the offset given, its bytes all the offset's last.
      const at = Number(b);
      const file = openSync(a, "r+");
      writeSync(file, Buffer.alloc(1 << 20, at & 255), 0, 1 << 20, at);
      closeSync(file);
    }
    else if (op === "keep-time") {
      const before = statSync(a);
      const bytes = readFileSync(a);
      bytes[0] = bytes[0] ^ 0xff;
      writeFileSync(a, bytes);
      utimesSync(a, before.atime, before.mtime);
    }
  } catch (error) { result = error.code ?? String(error); }
  out.push({ op, result, start, end: Date.now() });
}
process.stdout.write(JSON.stringify(out));
`;

export type Timed = {
  readonly op: string;
  readonly result: unknown;
  readonly start: number;
  readonly end: number;
};

const purpose = "timed-file-operations-test";

export class Contained {
  readonly #folders: TemporaryFolders;
  readonly #homes: string[] = [];
  #programs: string | undefined;

  constructor(folders: TemporaryFolders) {
    this.#folders = folders;
  }

  /** Gives `work` to a container. */
  async grant(work: string): Promise<Confined> {
    if (!this.#programs) {
      this.#programs = await this.#folders.make("zhiyin-watch-programs-");
      await copyFile(process.execPath, join(this.#programs, "node.exe"));
      await writeFile(join(this.#programs, "timed.mjs"), timed);
    }
    const home = await this.#folders.make("zhiyin-watch-home-");
    this.#homes.push(home);
    return confine({
      purpose,
      home,
      read: [this.#programs],
      write: [work],
      hosts: [],
    });
  }

  /** Runs the operations in the container; settles with each one's timing. */
  async run(confined: Confined, ops: readonly (readonly string[])[]) {
    const output = await this.#folders.make("zhiyin-watch-out-");
    const container = openProcessContainer();
    const programs = this.#programs!;
    try {
      const child = container.launch({
        executable: join(programs, "node.exe"),
        arguments: [
          "--preserve-symlinks-main",
          "--preserve-symlinks",
          join(programs, "timed.mjs"),
          JSON.stringify(ops),
        ],
        cwd: programs,
        stdout: join(output, "out.txt"),
        stderr: join(output, "error.txt"),
        confined,
      });
      const code = await child.wait();
      const text = await readFile(join(output, "out.txt"), "utf8");
      if (code !== 0 || !text)
        throw new Error(await readFile(join(output, "error.txt"), "utf8"));
      return JSON.parse(text) as Timed[];
    } finally {
      container.close();
    }
  }

  forget(): void {
    for (const home of this.#homes.splice(0)) forgetConfinement(purpose, home);
  }
}
