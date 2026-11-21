/**
 * Builds Zhiyin's shell into `apps/desktop/busybox`, where packaging and the
 * built app take it (ADR 0029):
 *
 * - `busybox.exe`: busybox-w32 at the commit `scripts/busybox/pins.json`
 *   names, with Zhiyin's patches it lists, in order, built with the
 *   configuration of the release it names: `null-device.patch` emulates
 *   /dev/null where an app container is refused Windows' null device, and
 *   `exec-wait.patch` keeps the shell waiting for the command it runs last
 *   when it cannot see its parent outside the container;
 * - `git/git.exe`: the git a sealed-off shell finds, `git-handoff.c`, which
 *   hands each git command to Zhiyin;
 * - `source/`: what both are built from, which the installer carries for
 *   busybox-w32's GPL-2.0: busybox-w32's source exactly as downloaded, the
 *   patches, `git-handoff.c` and the pins.
 *
 * Both are built with the pinned w64devkit, a native Windows toolchain. The
 * toolchain and the source are downloaded and kept only if their SHA-256 is
 * the one pinned, unpacked with Windows' own `tar`, which runs nothing they
 * hold, and built with the source's commit time, in UTC, as the build time,
 * so the machine's time zone does not reach the build. Each
 * built file must then have the SHA-256 the pins record, so a build that
 * comes out different fails. ADR 0027.
 *
 * The downloads are kept between builds in `busybox` below `ZHIYIN_TEST_TOOLS`
 * when that names a folder, as the test tools are, and otherwise in
 * `node_modules/.cache/zhiyin-tools/busybox`. A build in place is not made
 * again, so the gate runs this before the tests, which need the shell.
 *
 * `--record` writes the built files' SHA-256 into the pins instead, after a
 * deliberate change of the pins, the patch or the hand-off program.
 * `--check <folder>` builds nothing and fails, naming each, when the folder
 * lacks a built file or a source file, or holds one that differs: the
 * packaged app's folder, before a release.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchVerified, misplacedFiles } from "./verified-files.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The built files, by their path in the output folder. */
export const builtFiles = ["busybox.exe", "git/git.exe"];

/** Zhiyin's own files the build reads, kept in the source beside busybox-w32's. */
const ownSources = (pins) => [
  ...pins.busybox.patches,
  "git-handoff.c",
  "pins.json",
];

/**
 * The source the output must carry, by path in the output folder, with each
 * file's SHA-256: busybox-w32's as pinned, and Zhiyin's as the repository
 * holds them.
 */
export async function sourceFiles({ repository, pins }) {
  const own = [];
  for (const file of ownSources(pins))
    own.push({
      file: `source/${file}`,
      sha256: sha256(
        await readFile(join(repository, "scripts", "busybox", file)),
      ),
    });
  return [
    { file: `source/${pins.busybox.file}`, sha256: pins.busybox.sha256 },
    ...own,
  ];
}

/** What `folder` lacks or holds otherwise, of the built files and the source. */
export async function misplacedShell({ repository, pins, folder }) {
  return misplacedFiles({
    files: [
      ...builtFiles.map((file) => ({ file, sha256: pins.built[file] })),
      ...(await sourceFiles({ repository, pins })),
    ],
    folder,
  });
}

/** Fetches the pinned files into `downloads`, each kept only when its SHA-256 is the pinned one. */
function fetchPinned(pins, kinds, downloads) {
  return fetchVerified({
    files: kinds.map(({ file, url, sha256 }) => ({ file, url, sha256 })),
    folder: downloads,
    download,
  });
}

/** Copies the source into `output/source`, busybox-w32's fetched into `downloads` when missing. */
export async function placeSource({ repository, pins, downloads, output }) {
  await fetchPinned(pins, [pins.busybox], downloads);
  const source = join(output, "source");
  await rm(source, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  await copyFile(
    join(downloads, pins.busybox.file),
    join(source, pins.busybox.file),
  );
  for (const file of ownSources(pins))
    await copyFile(
      join(repository, "scripts", "busybox", file),
      join(source, file),
    );
}

/** The large toolchain takes longer than a minute on a slow connection. */
async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

function run(executable, args, options) {
  const ran = spawnSync(executable, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (ran.error) throw ran.error;
  if (ran.status !== 0)
    throw new Error(
      `${executable} ${args.join(" ")} exited with ${ran.status}.`,
    );
}

/** Windows' own tar, by its full path, so no other program of its name runs. */
const tar = join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "tar.exe",
);

/**
 * Builds both files into `output` from the pins, with what it downloads kept
 * in `downloads`, working in `work`, a short path, as the toolchain's own is
 * long. Answers each built file's SHA-256.
 */
export async function buildShell({
  repository,
  pins,
  work,
  downloads,
  output,
}) {
  await fetchPinned(pins, [pins.w64devkit, pins.busybox], downloads);
  const toolchain = join(work, "toolchain");
  const source = join(work, "source");
  for (const folder of [toolchain, source]) {
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
  }
  run(tar, ["-xf", join(downloads, pins.w64devkit.file), "-C", toolchain]);
  run(tar, ["-xzf", join(downloads, pins.busybox.file), "-C", source]);
  const bin = join(toolchain, "w64devkit", "bin");
  const tree = join(source, `busybox-w32-${pins.busybox.commit}`);
  const environment = {
    PATH: [
      bin,
      join(process.env["SystemRoot"] ?? "C:\\Windows", "System32"),
    ].join(";"),
    SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows",
    TEMP: work,
    TMP: work,
    SOURCE_DATE_EPOCH: String(Date.parse(pins.busybox.committed) / 1000),
    // busybox writes that time in UTC but names the zone with %Z, which on
    // Windows is the machine's own zone unless TZ names one.
    TZ: "UTC",
  };
  for (const patch of pins.busybox.patches)
    run(
      join(bin, "patch.exe"),
      ["-p1", "-i", join(repository, "scripts", "busybox", patch)],
      { cwd: tree, env: environment },
    );
  // The version busybox reports: its release's, marked as Zhiyin's build.
  await writeFile(
    join(tree, ".frp_describe"),
    `${pins.busybox.release}-zhiyin\n`,
  );
  run(
    join(bin, "sh.exe"),
    [
      "-c",
      `make ${pins.busybox.configuration} && make -j4 LDFLAGS=-Wl,--no-insert-timestamp`,
    ],
    { cwd: tree, env: environment },
  );
  const handoff = join(work, "git.exe");
  run(
    join(bin, "gcc.exe"),
    [
      "-O2",
      "-s",
      "-Wall",
      "-Wl,--no-insert-timestamp",
      "-o",
      handoff,
      join(repository, "scripts", "busybox", "git-handoff.c"),
      "-lshell32",
    ],
    { cwd: work, env: environment },
  );
  await mkdir(join(output, "git"), { recursive: true });
  await copyFile(join(tree, "busybox.exe"), join(output, "busybox.exe"));
  await copyFile(handoff, join(output, "git", "git.exe"));
  const built = {};
  for (const file of builtFiles)
    built[file] = sha256(await readFile(join(output, file)));
  return built;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const pinsFile = join(repository, "scripts", "busybox", "pins.json");
  const pins = JSON.parse(await readFile(pinsFile, "utf8"));
  const checked = process.argv.indexOf("--check");
  if (checked !== -1) {
    const folder = process.argv[checked + 1];
    if (!folder) throw new Error("--check needs the folder to check.");
    const misplaced = await misplacedShell({ repository, pins, folder });
    for (const file of misplaced)
      console.error(`${folder} lacks ${file}, or holds another one.`);
    if (!misplaced.length)
      console.log(
        `${folder} holds Zhiyin's busybox as pinned, and its source.`,
      );
    process.exit(misplaced.length ? 1 : 0);
  }
  const output = join(repository, "apps", "desktop", "busybox");
  const downloads = process.env["ZHIYIN_TEST_TOOLS"]
    ? join(process.env["ZHIYIN_TEST_TOOLS"], "busybox")
    : join(repository, "node_modules", ".cache", "zhiyin-tools", "busybox");
  const builtInPlace =
    (
      await misplacedFiles({
        files: builtFiles.map((file) => ({ file, sha256: pins.built[file] })),
        folder: output,
      })
    ).length === 0;
  if (!process.argv.includes("--record") && builtInPlace) {
    if ((await misplacedShell({ repository, pins, folder: output })).length)
      await placeSource({ repository, pins, downloads, output });
    console.log("Zhiyin's busybox is in place.");
    process.exit(0);
  }
  const built = await buildShell({
    repository,
    pins,
    work: join(tmpdir(), "zhiyin-busybox"),
    downloads,
    output,
  });
  if (process.argv.includes("--record")) {
    pins.built = built;
    await writeFile(pinsFile, `${JSON.stringify(pins, null, 2)}\n`);
    console.log("Recorded:", built);
  } else {
    const differ = builtFiles.filter(
      (file) => built[file] !== pins.built[file],
    );
    if (differ.length) {
      await rm(output, { recursive: true, force: true });
      throw new Error(
        `The build of ${differ.join(" and ")} differs from the one pinned, so it was not kept.`,
      );
    }
    console.log("Zhiyin's busybox built, as pinned.");
  }
  // After the pins are recorded, so the source carries the pins it was built by.
  await placeSource({ repository, pins, downloads, output });
}
