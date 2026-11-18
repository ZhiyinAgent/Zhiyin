#!/usr/bin/env node
/**
 * Rehearses an update end to end (ADR 0027; docs/maintainers.md, "Rehearsing an
 * update"): builds Zhiyin as a rehearsal build, packages it as two versions,
 * installs the older one silently into a folder of its own, and serves
 * releases to it from a server on this computer, signed with a key made for
 * the run. Each case starts the installed copy and checks what it asked for
 * and what is installed afterwards:
 *
 *   - a release with no signature, one signed with another key, one whose
 *     installer is not the one its signature names, and an older signed one
 *     are each refused before the installer is downloaded;
 *   - an installer changed on the way, after the signature held, is
 *     downloaded but never installed;
 *   - a signed newer release is downloaded, installed, and started.
 *
 *   node scripts/update-rehearsal.mjs [--keep] [--github <owner/repo>]
 *
 * With --github, the same build updates through that repository's releases
 * instead, which must be public and which gh can write to: a draft release
 * is not taken, and once published it is installed and started. The release
 * is deleted at the end.
 *
 * A rehearsal build hides its window, keeps a data folder of its own and
 * restarts into an update once it is ready, so nothing here touches the
 * Zhiyin installed on this computer. --keep leaves the work folder for a look
 * afterwards. Takes two packagings; needs nothing from the network but what a
 * build needs.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveWorkspaceTypeScript } from "./workspace-typescript.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = join(repository, "apps", "desktop");
const product = "ZhiyinRehearsal";
const dataFolder = join(process.env.APPDATA ?? "", "Zhiyin Update Rehearsal");

/** The version after this one: its last number raised by one. */
export function nextVersion(version) {
  const match = /^(.*?)(\d+)$/.exec(version);
  if (!match) throw new Error(`${version} ends in no number.`);
  return `${match[1]}${Number(match[2]) + 1}`;
}

function keyPair(id) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    id,
    secret: privateKey,
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function releaseOf(path, version) {
  const bytes = readFileSync(path);
  return {
    version,
    file: basename(path),
    size: bytes.byteLength,
    sha512: createHash("sha512").update(bytes).digest("base64"),
  };
}

function signatureOf(release, key, signedText) {
  return JSON.stringify({
    key: key.id,
    ...release,
    signature: sign(
      null,
      Buffer.from(signedText(release), "utf8"),
      key.secret,
    ).toString("base64"),
  });
}

/** latest.yml naming a release, as electron-builder writes it. */
function latestYml(release) {
  return [
    `version: ${release.version}`,
    "files:",
    `  - url: ${release.file}`,
    `    sha512: ${release.sha512}`,
    `    size: ${release.size}`,
    `path: ${release.file}`,
    `sha512: ${release.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");
}

/** A server on this computer giving the files it is set to, and keeping what was asked. */
async function releaseServer() {
  let files = new Map();
  const asked = [];
  const server = createServer((request, response) => {
    const name = decodeURIComponent(
      new URL(request.url ?? "/", "http://here").pathname.slice(1),
    );
    asked.push(name);
    const body = files.get(name);
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": body.byteLength });
    response.end(body);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    asked,
    serve(next) {
      files = new Map(
        Object.entries(next).map(([name, body]) => [
          name,
          Buffer.isBuffer(body) ? body : Buffer.from(body),
        ]),
      );
      asked.length = 0;
    },
    close: () => new Promise((done) => server.close(done)),
  };
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    stdio: "inherit",
    shell: command === "pnpm",
    ...options,
  });
}

/** Packages the built app as one version, into a folder of its own. */
function packageAs(version, into, server) {
  // The app's own configuration, with what makes it a rehearsal on top. The
  // publish setting is a list here, which replaces the app's whole rather
  // than merging a server address into GitHub's owner and repository.
  const config = `${into}.json`;
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(desktop, "electron-builder.yml"),
      productName: product,
      appId: "com.zhiyin.update-rehearsal",
      extraMetadata: { version },
      nsis: { createDesktopShortcut: false, createStartMenuShortcut: false },
      directories: { output: into },
      publish: [
        {
          provider: "generic",
          url: server,
          updaterCacheDirName: "zhiyin-rehearsal-updater",
        },
      ],
    }),
  );
  run(
    "pnpm",
    ["exec", "electron-builder", "--publish", "never", "--config", config],
    { cwd: desktop },
  );
  const installer = readdirSync(into).find((name) => name.endsWith(".exe"));
  if (!installer) throw new Error(`Packaging ${version} made no installer.`);
  return join(into, installer);
}

/** The installed version, or "" while the installer has removed the file. */
function installedVersion(executable) {
  if (!existsSync(executable)) return "";
  return execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-Item -LiteralPath '${executable}').VersionInfo.FileVersion`,
    ],
    { encoding: "utf8" },
  ).trim();
}

/** Ends every process started from the install folder. */
function endInstalled(folder) {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Get-Process | Where-Object { $_.Path -like '${folder}\\*' } | Stop-Process -Force`,
    ],
    { stdio: "ignore" },
  );
}

function runningFrom(folder) {
  return (
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `@(Get-Process | Where-Object { $_.Path -like '${folder}\\*' }).Count`,
      ],
      { encoding: "utf8" },
    ).trim() !== "0"
  );
}

async function until(what, holds, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (holds()) return;
    await delay(500);
  }
  throw new Error(`Gave up waiting ${seconds} s for ${what}.`);
}

/**
 * The same update through a GitHub repository's releases, as an installed
 * copy reads them: a draft is not taken, and once published it is installed
 * and started. The release is deleted afterwards.
 */
async function onGitHub({
  repo,
  work,
  release,
  files,
  executable,
  install,
  older,
  newer,
}) {
  const tag = `v${newer}`;
  const gh = (...args) =>
    execFileSync("gh", [...args, "--repo", repo], { stdio: "inherit" });
  const results = [];
  const latest = join(work, "latest.yml");
  writeFileSync(latest, latestYml(release));
  gh(
    "release",
    "create",
    tag,
    ...files,
    latest,
    "--draft",
    "--prerelease",
    "--title",
    `Update rehearsal ${newer}`,
    "--notes",
    "Made by scripts/update-rehearsal.mjs, and deleted when it ends.",
  );
  try {
    const start = () =>
      spawn(executable, [], { detached: true, stdio: "ignore" }).unref();
    start();
    await delay(60_000);
    results.push(
      installedVersion(executable) === older
        ? "ok    a draft release on GitHub is not taken"
        : "FAIL  a draft release on GitHub is not taken: the install changed",
    );
    endInstalled(install);
    await delay(1500);
    gh("release", "edit", tag, "--draft=false");
    start();
    try {
      await until(
        `${newer} to be installed from GitHub`,
        () => {
          try {
            return installedVersion(executable) === newer;
          } catch {
            return false;
          }
        },
        600,
      );
      await until(`${newer} to be running`, () => runningFrom(install), 60);
      results.push(
        "ok    a signed release published on GitHub is installed and started",
      );
    } catch (error) {
      results.push(
        `FAIL  a signed release published on GitHub is installed and started: ${error.message}`,
      );
    }
  } finally {
    endInstalled(install);
    try {
      gh("release", "delete", tag, "--yes", "--cleanup-tag");
    } catch {
      console.warn(`Delete the release ${tag} in ${repo} by hand.`);
    }
  }
  return results;
}

async function rehearse(keep, repo) {
  resolveWorkspaceTypeScript();
  const { signedText } = await import(
    pathToFileURL(join(repository, "packages/feature/updates/src/index.ts"))
      .href
  );
  const work = mkdtempSync(join(tmpdir(), "zhiyin-rehearsal-"));
  const install = join(work, "install");
  const executable = join(install, `${product}.exe`);
  const server = await releaseServer();
  const key = keyPair("rehearsal");
  const older = JSON.parse(
    readFileSync(join(desktop, "package.json"), "utf8"),
  ).version;
  const newer = nextVersion(older);
  const results = [];
  try {
    if (existsSync(dataFolder))
      throw new Error(
        `${dataFolder} is left from an earlier rehearsal; remove it first.`,
      );
    run("node", ["../../scripts/dictionaries.mjs"], { cwd: desktop });
    run("node", ["../../scripts/fonts.mjs"], { cwd: desktop });
    run("pnpm", ["exec", "electron-vite", "build"], {
      cwd: desktop,
      env: {
        ...process.env,
        ZHIYIN_UPDATE_REHEARSAL: JSON.stringify({
          rehearsal: "zhiyin-update-rehearsal",
          keys: { [key.id]: key.spki },
          places: repo
            ? [
                {
                  name: "GitHub",
                  kind: "github",
                  owner: repo.split("/")[0],
                  repository: repo.split("/")[1],
                },
              ]
            : [
                {
                  name: "the rehearsal server",
                  kind: "folder",
                  url: server.url,
                },
              ],
        }),
      },
    });
    const first = packageAs(older, join(work, `build-${older}`), server.url);
    const second = packageAs(newer, join(work, `build-${newer}`), server.url);
    const blockmap = `${second}.blockmap`;
    const release = releaseOf(second, newer);
    const signed = signatureOf(release, key, signedText);
    const installer = readFileSync(second);
    const name = release.file;

    console.log(`Installing ${older} into ${install}`);
    run(first, ["/S", `/D=${install}`]);
    if (installedVersion(executable) !== older)
      throw new Error(`The install is not ${older}.`);

    if (repo) {
      const signature = join(work, `${name}.sig`);
      writeFileSync(signature, signed);
      results.push(
        ...(await onGitHub({
          repo,
          work,
          release,
          files: [second, blockmap, signature],
          executable,
          install,
          older,
          newer,
        })),
      );
    } else await onThisComputer();

    /** The six cases, against the server on this computer. */
    async function onThisComputer() {
      /** Starts the installed copy, and gives it time to look once. */
      async function look(caseName, files, check) {
        server.serve(files);
        const app = spawn(executable, [], { detached: true, stdio: "ignore" });
        app.unref();
        try {
          await check();
          results.push(`ok    ${caseName}`);
        } catch (error) {
          results.push(`FAIL  ${caseName}: ${error.message}`);
        } finally {
          endInstalled(install);
          await delay(1500);
        }
      }

      const askedFor = (file) => server.asked.includes(file);
      const refusedBeforeDownload = async () => {
        await until(
          "the signature to be asked for",
          () => askedFor(`${name}.sig`),
          60,
        );
        await delay(5000);
        if (askedFor(name)) throw new Error("the installer was downloaded");
        if (installedVersion(executable) !== older)
          throw new Error("the install changed");
      };

      await look(
        "a release with no signature is refused before downloading",
        {
          "latest.yml": latestYml(release),
          [name]: installer,
          [`${name}.blockmap`]: readFileSync(blockmap),
        },
        refusedBeforeDownload,
      );
      await look(
        "a release signed with another key is refused before downloading",
        {
          "latest.yml": latestYml(release),
          [name]: installer,
          [`${name}.sig`]: signatureOf(
            release,
            keyPair("rehearsal"),
            signedText,
          ),
        },
        refusedBeforeDownload,
      );
      const tampered = Buffer.concat([installer, Buffer.from("changed")]);
      const named = {
        ...release,
        size: tampered.byteLength,
        sha512: createHash("sha512").update(tampered).digest("base64"),
      };
      await look(
        "a release whose installer is not the signed one is refused before downloading",
        {
          "latest.yml": latestYml(named),
          [name]: tampered,
          [`${name}.sig`]: signed,
        },
        refusedBeforeDownload,
      );
      const old = releaseOf(first, older);
      await look(
        "an older signed release is not taken",
        {
          "latest.yml": latestYml(old),
          [old.file]: readFileSync(first),
          [`${old.file}.sig`]: signatureOf(old, key, signedText),
        },
        async () => {
          await until(
            "latest.yml to be asked for",
            () => askedFor("latest.yml"),
            60,
          );
          await delay(5000);
          if (askedFor(`${old.file}.sig`) || askedFor(old.file))
            throw new Error("the older release was looked at further");
        },
      );
      await look(
        "an installer changed on the way is downloaded but never installed",
        {
          "latest.yml": latestYml(release),
          [name]: tampered,
          [`${name}.sig`]: signed,
        },
        async () => {
          await until(
            "the installer to be asked for",
            () => askedFor(name),
            60,
          );
          await delay(15000);
          if (installedVersion(executable) !== older)
            throw new Error("the install changed");
          if (!runningFrom(install))
            throw new Error(`${older} stopped running`);
        },
      );
      await look(
        "a signed newer release is installed and started",
        {
          "latest.yml": latestYml(release),
          [name]: installer,
          [`${name}.blockmap`]: readFileSync(blockmap),
          [`${name}.sig`]: signed,
        },
        async () => {
          await until(
            "the installer to be asked for",
            () => askedFor(name),
            60,
          );
          await until(
            `${newer} to be installed`,
            () => {
              try {
                return installedVersion(executable) === newer;
              } catch {
                return false;
              }
            },
            240,
          );
          await until(`${newer} to be running`, () => runningFrom(install), 60);
        },
      );
    }
  } finally {
    endInstalled(install);
    await server.close();
    const uninstaller = join(install, `Uninstall ${product}.exe`);
    if (existsSync(uninstaller)) {
      try {
        // `_?=` runs it in place and waits, rather than from a copy that
        // returns at once.
        execFileSync(uninstaller, ["/S", `_?=${install}`], { stdio: "ignore" });
      } catch {
        console.warn(
          `${uninstaller} did not finish; remove ${install} by hand.`,
        );
      }
    }
    rmSync(dataFolder, { recursive: true, force: true });
    // The rehearsal's build is left in out/, where the installed suite and
    // `pnpm dev` would run it: the app's own build takes its place.
    try {
      run("pnpm", ["exec", "electron-vite", "build"], {
        cwd: desktop,
        env: { ...process.env, ZHIYIN_UPDATE_REHEARSAL: "" },
      });
    } catch {
      console.warn(
        "Build the app again before running it: out/ holds the rehearsal's build.",
      );
    }
    if (!keep) rmSync(work, { recursive: true, force: true });
    else console.log(`Kept ${work}`);
  }
  console.log(`\n${results.join("\n")}`);
  if (
    results.some((line) => line.startsWith("FAIL")) ||
    results.length !== (repo ? 2 : 6)
  )
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  await rehearse(
    process.argv.includes("--keep"),
    process.argv[process.argv.indexOf("--github") + 1] &&
      process.argv.includes("--github")
      ? process.argv[process.argv.indexOf("--github") + 1]
      : undefined,
  );
