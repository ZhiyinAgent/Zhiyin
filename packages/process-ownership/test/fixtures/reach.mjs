// Tries each operation it is given and reports what Windows let it do: "done",
// what it read, or the error's code. Run confined, it shows what the container
// reaches; `child` runs the same operations in a process it starts.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const operations = JSON.parse(process.argv[2]);

const connects = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port: Number(port), timeout: 10_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("timeout");
    });
    socket.once("error", (error) => resolve(error.code ?? error.message));
  });

const actions = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path) => writeFileSync(path, "written confined"),
  append: (path) => appendFileSync(path, " and appended"),
  mkdir: (path) => mkdirSync(path),
  rename: (from, to) => renameSync(from, to),
  delete: (path) => rmSync(path),
  list: (path) => readdirSync(path).join(","),
  env: (name) => process.env[name] ?? "",
  /** Writes a file in the folder a variable names and answers its path. */
  leave: (name, file) => {
    const path = join(process.env[name] ?? "", file);
    writeFileSync(path, `left in ${name}`);
    return path;
  },
  pid: (path) => writeFileSync(path, String(process.pid)),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  /** Writes and reads back a file in the temporary folder, and answers where. */
  temporary: () => {
    const path = join(tmpdir(), `reach-${process.pid}.txt`);
    writeFileSync(path, "temporary");
    readFileSync(path, "utf8");
    rmSync(path);
    return path;
  },
  connect: connects,
  // The child's streams are files: inside a container, Node waits forever for
  // the pipes it would name outside the container's own, and may not open the
  // NUL device it would give an ignored stream.
  child: (nested) => {
    const report = join(tmpdir(), `reach-child-${process.pid}.json`);
    const errors = `${report}.err`;
    const output = openSync(report, "w");
    const error = openSync(errors, "w");
    const input = openSync(process.argv[1], "r");
    try {
      const ran = spawnSync(
        process.execPath,
        [...process.execArgv, process.argv[1], JSON.stringify(nested)],
        { stdio: [input, output, error] },
      );
      if (ran.error) throw ran.error;
    } finally {
      for (const descriptor of [input, output, error]) closeSync(descriptor);
    }
    const printed = readFileSync(report, "utf8");
    const said = readFileSync(errors, "utf8");
    rmSync(report);
    rmSync(errors);
    if (!printed) throw new Error(`The child reported nothing: ${said}`);
    return JSON.parse(printed);
  },
};

const results = [];
for (const [name, ...given] of operations) {
  try {
    const value = await actions[name](...given);
    results.push(value === undefined ? "done" : value);
  } catch (error) {
    results.push(error.code ?? error.message);
  }
}
process.stdout.write(JSON.stringify(results));
