/**
 * The release script signs what an installed app checks (ADR 0027): a
 * signature it makes is taken by the app's own check, and it signs nothing
 * the workflow's checksum or latest.yml does not name.
 */

import { createHash, generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TemporaryFolders } from "@zhiyin/test-support";
import { modelListKeys } from "@zhiyin/model-client";
import {
  checkSignature,
  releaseKeys,
  readReleaseSignature,
  releaseKeysOf,
  signedText,
} from "@zhiyin/updates";
import {
  checkChecksums,
  checkLatest,
  latestOf,
  releaseOfInstaller,
  signatureFor,
} from "./release.mjs";

const folders = new TemporaryFolders();
afterEach(() => folders.removeAll());

async function installer(bytes = "an installer") {
  const folder = await folders.make("zhiyin-release-");
  const path = join(folder, "Zhiyin-Setup-0.1.0-alpha.2.exe");
  await writeFile(path, bytes);
  return path;
}

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    id: "release-primary-2026-11",
    key: privateKey,
    shipped: releaseKeysOf({
      "release-primary-2026-11": publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    }),
  };
}

/** latest.yml as electron-builder 26 writes it beside an NSIS installer. */
function latestYml(release) {
  return [
    `version: ${release.version}`,
    "files:",
    `  - url: ${release.file}`,
    `    sha512: ${release.sha512}`,
    `    size: ${release.size}`,
    `path: ${release.file}`,
    `sha512: ${release.sha512}`,
    "releaseDate: '2026-11-07T10:00:00.000Z'",
    "",
  ].join("\n");
}

describe("signing a release", () => {
  it("makes a signature the app takes for that installer", async () => {
    const release = releaseOfInstaller(await installer());
    const key = signer();

    const text = signatureFor(release, key, signedText);

    expect(() =>
      checkSignature(
        readReleaseSignature(text),
        release,
        "0.1.0-alpha.1",
        key.shipped,
      ),
    ).not.toThrow();
  });

  it("makes a signature the app refuses for any other installer", async () => {
    const key = signer();
    const signed = releaseOfInstaller(await installer("an installer"));
    const other = releaseOfInstaller(await installer("another installer"));

    const text = signatureFor(signed, key, signedText);

    expect(() =>
      checkSignature(
        readReleaseSignature(text),
        other,
        "0.1.0-alpha.1",
        key.shipped,
      ),
    ).toThrow("not the one the release's signature names");
  });

  it("reads the version from the installer's name", async () => {
    expect(releaseOfInstaller(await installer())).toMatchObject({
      version: "0.1.0-alpha.2",
      file: "Zhiyin-Setup-0.1.0-alpha.2.exe",
      size: 12,
    });
  });
});

describe("the keys", () => {
  it("never sign a release with a key that signs model lists", () => {
    const listKeys = new Set(Object.values(modelListKeys));

    expect(
      Object.values(releaseKeys).filter((key) => listKeys.has(key)),
    ).toEqual([]);
  });
});

describe("what is checked before signing", () => {
  it("finds latest.yml naming exactly the installer", async () => {
    const release = releaseOfInstaller(await installer());

    expect(checkLatest(latestOf(latestYml(release)), release)).toEqual([]);
  });

  it("finds latest.yml naming another installer", async () => {
    const release = releaseOfInstaller(await installer());
    const other = releaseOfInstaller(await installer("another installer"));

    expect(checkLatest(latestOf(latestYml(other)), release)).toEqual([
      "latest.yml's SHA-512 is not the installer's.",
      `latest.yml's size is ${other.size}, not ${release.size}.`,
    ]);
  });

  it("holds the installer to the workflow's checksum", async () => {
    const path = await installer();
    const sha256 = createHash("sha256").update("an installer").digest("hex");

    expect(
      checkChecksums(`${sha256} *Zhiyin-Setup-0.1.0-alpha.2.exe\n`, path),
    ).toEqual([]);
    expect(
      checkChecksums(
        `${"0".repeat(64)} *Zhiyin-Setup-0.1.0-alpha.2.exe\n`,
        path,
      ),
    ).toEqual(["SHA256SUMS.txt does not name the installer's SHA-256."]);
  });
});
