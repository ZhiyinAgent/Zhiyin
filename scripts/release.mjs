#!/usr/bin/env node
/**
 * Release keys, and the signature an installed app checks before it runs a
 * newer installer (ADR 0027; how to use it: docs/maintainers.md, "Releases and
 * updates").
 *
 *   node scripts/release.mjs keys <folder outside the repository>
 *     Makes the primary and the backup release key, each a
 *     passphrase-encrypted PKCS#8 file in that folder, and prints the public
 *     halves to paste into packages/feature/updates/src/release-keys.ts.
 *
 *   node scripts/release.mjs publish <tag> <private key file>
 *       (--mirror <rclone remote:bucket> | --no-mirror) [--repo <owner/name>]
 *     Downloads the draft release the release workflow made for the tag,
 *     checks the installer against the workflow's checksum, its build
 *     attestation and latest.yml, signs it, uploads the signature, copies the
 *     release's files to Zhiyin's host when --mirror names it, and publishes
 *     the release. --no-mirror leaves Zhiyin's host alone, for a release in a
 *     scratch repository. Needs gh, signed in as a maintainer, and rclone.
 */

import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fail, makeKeys, openKey } from "./signing-keys.mjs";
import { resolveWorkspaceTypeScript } from "./workspace-typescript.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The updates package, loaded as plain Node strips its types. */
export async function loadUpdates() {
  resolveWorkspaceTypeScript();
  return import(
    pathToFileURL(join(repository, "packages/feature/updates/src/index.ts"))
      .href
  );
}

/** What a signature names about an installer, measured from the file. */
export function releaseOfInstaller(path) {
  const bytes = readFileSync(path);
  const name = basename(path);
  const version = /^Zhiyin-Setup-(.+)\.exe$/.exec(name)?.[1];
  if (!version)
    throw new Error(`${name} is not named Zhiyin-Setup-<version>.exe.`);
  return {
    version,
    file: name,
    size: bytes.byteLength,
    sha512: createHash("sha512").update(bytes).digest("base64"),
  };
}

/**
 * The fields of electron-builder's latest.yml that name the installer. The
 * file is flat apart from its `files` list, so it is read line by line.
 */
export function latestOf(text) {
  const field = (name, indent = "") =>
    new RegExp(`^${indent}${name}: '?([^'\\r\\n]+)'?\\s*$`, "m").exec(
      text,
    )?.[1];
  const size = field("size", " {4}");
  return {
    version: field("version"),
    path: field("path"),
    sha512: field("sha512"),
    size: size === undefined ? undefined : Number(size),
  };
}

/** Holds when latest.yml names exactly this installer. */
export function checkLatest(latest, release) {
  const problems = [];
  if (latest.version !== release.version)
    problems.push(
      `latest.yml names version ${latest.version}, not ${release.version}.`,
    );
  if (latest.path !== release.file)
    problems.push(`latest.yml names ${latest.path}, not ${release.file}.`);
  if (latest.sha512 !== release.sha512)
    problems.push("latest.yml's SHA-512 is not the installer's.");
  if (latest.size !== release.size)
    problems.push(`latest.yml's size is ${latest.size}, not ${release.size}.`);
  return problems;
}

/** Holds when the workflow's SHA256SUMS.txt names exactly this installer. */
export function checkChecksums(text, path) {
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const expected = `${sha256} *${basename(path)}`;
  return text.trim() === expected
    ? []
    : ["SHA256SUMS.txt does not name the installer's SHA-256."];
}

/** The signature file's text for a release, signed with the key given. */
export function signatureFor(release, { id, key }, signedText) {
  const signature = sign(null, Buffer.from(signedText(release), "utf8"), key);
  return `${JSON.stringify({ key: id, ...release, signature: signature.toString("base64") })}\n`;
}

const gh = (...args) =>
  execFileSync("gh", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

function option(rest, name) {
  const at = rest.indexOf(name);
  return at >= 0 ? rest[at + 1] : undefined;
}

async function publish(tag, keyFile, rest) {
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag ?? ""))
    fail("Name the release's tag, such as v0.1.0-alpha.2.");
  if (!keyFile) fail("Name the private release key file to sign with.");
  const repo = option(rest, "--repo") ?? "ZhiyinAgent/Zhiyin";
  const mirror = option(rest, "--mirror");
  if (!mirror && !rest.includes("--no-mirror"))
    fail(
      "Name Zhiyin's host with --mirror <remote:bucket>, or say --no-mirror for a release no one installs from there.",
    );
  const updates = await loadUpdates();
  const view = JSON.parse(
    gh("release", "view", tag, "--repo", repo, "--json", "isDraft,assets"),
  );
  if (!view.isDraft)
    fail(
      `${tag} is already published; a published release is never re-signed.`,
    );
  const folder = mkdtempSync(join(tmpdir(), "zhiyin-release-"));
  try {
    gh("release", "download", tag, "--repo", repo, "--dir", folder);
    const names = view.assets.map((asset) => asset.name);
    const installerName = names.find((name) =>
      /^Zhiyin-Setup-.+\.exe$/.test(name),
    );
    if (!installerName) fail(`${tag} has no installer.`);
    const installer = join(folder, installerName);
    for (const needed of [
      "latest.yml",
      "SHA256SUMS.txt",
      `${installerName}.blockmap`,
    ])
      if (!names.includes(needed)) fail(`${tag} has no ${needed}.`);
    const release = releaseOfInstaller(installer);
    if (`v${release.version}` !== tag)
      fail(`${installerName} is not the installer of ${tag}.`);
    const problems = [
      ...checkChecksums(
        readFileSync(join(folder, "SHA256SUMS.txt"), "utf8"),
        installer,
      ),
      ...checkLatest(
        latestOf(readFileSync(join(folder, "latest.yml"), "utf8")),
        release,
      ),
    ];
    if (problems.length) fail(`${problems.join("\n")}\nNothing was signed.`);
    try {
      gh("attestation", "verify", installer, "--repo", repo);
    } catch {
      fail(
        "The installer's build attestation does not verify; nothing was signed.",
      );
    }
    const signer = await openKey(keyFile);
    const text = signatureFor(release, signer, updates.signedText);
    // Checked as an installed app checks it, against the keys it ships.
    const shipped = updates.releaseKeysOf(updates.releaseKeys);
    if (!shipped.has(signer.id))
      fail(
        `${signer.id} is not in packages/feature/updates/src/release-keys.ts; no app would take this release.`,
      );
    updates.checkSignature(
      updates.readReleaseSignature(text),
      release,
      "0.0.0",
      shipped,
    );
    const signature = join(folder, `${installerName}.sig`);
    writeFileSync(signature, text);
    gh("release", "upload", tag, signature, "--repo", repo, "--clobber");
    console.log(`Signed ${installerName} with ${signer.id}.`);
    if (mirror) {
      // latest.yml goes last, so the copy never names a file it lacks.
      for (const name of [
        installerName,
        `${installerName}.blockmap`,
        `${installerName}.sig`,
        "latest.yml",
      ])
        execFileSync(
          "rclone",
          ["copyto", join(folder, name), `${mirror}/releases/${name}`],
          {
            stdio: "inherit",
          },
        );
      console.log("Copied the release to media.zhiyinagent.app/releases/.");
    }
    gh("release", "edit", tag, "--repo", repo, "--draft=false");
    console.log(`Published ${tag}.`);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, first, second, ...rest] = process.argv.slice(2);
  if (command === "keys")
    await makeKeys(first, {
      prefix: "release-",
      target: "packages/feature/updates/src/release-keys.ts",
    });
  else if (command === "publish") await publish(first, second, rest);
  else
    fail(
      "Use: node scripts/release.mjs keys <folder> | publish <tag> <key file> (--mirror <remote:bucket> | --no-mirror) [--repo <owner/name>]",
    );
}
