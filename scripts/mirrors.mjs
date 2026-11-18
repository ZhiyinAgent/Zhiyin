#!/usr/bin/env node
/**
 * Zhiyin's copies of files it downloads, kept on its own host for people the
 * original sites do not reach, and the check that every place a download may
 * come from still gives the pinned file (ADR 0027; how to use it:
 * docs/maintainers.md, "Mirrors").
 *
 *   node scripts/mirrors.mjs check [--quick]
 *     Asks every place each pinned program, Tectonic's bundle and the model
 *     list may be downloaded from, and confirms each answers with the pinned
 *     size and SHA-256, reading every file whole and keeping nothing; with
 *     --quick, only that each answers with the pinned size. Zhiyin's copy of
 *     the model list must be byte for byte the one on GitHub. Needs the
 *     network, so it is not part of the gate.
 *
 *   node scripts/mirrors.mjs upload <rclone remote:bucket> [--only <prefix>]
 *     Downloads from its original each file Zhiyin keeps a copy of, keeps it
 *     only if its size and SHA-256 are the pinned ones, and uploads it with
 *     rclone under the same path as on media.zhiyinagent.app; then names the
 *     copies under toolchains/ that this build no longer reads. The model
 *     list is uploaded from this checkout, and only when it is byte for byte
 *     the one on GitHub's main branch. Needs rclone, set up with a remote for
 *     the R2 bucket behind media.zhiyinagent.app.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveWorkspaceTypeScript } from "./workspace-typescript.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = "media.zhiyinagent.app";
const modelListFolder = join(
  repository,
  "packages/feature/model-client/model-list",
);

/** The path of a file on Zhiyin's host, as the bucket keys it. */
export function keyOf(url) {
  const address = new URL(url);
  if (address.host !== host) throw new Error(`${url} is not on ${host}.`);
  return decodeURIComponent(address.pathname.slice(1));
}

/**
 * Every file Zhiyin keeps a copy of, with where the original is and the size
 * and SHA-256 both are pinned to. The model list is not among them: it is
 * uploaded from the repository, whatever its fingerprint.
 */
export function copiedFiles(toolchains, bundle) {
  const copies = toolchains.flatMap((spec) =>
    spec.sources
      .filter((source) => source.hosts[0] === host)
      .map((source) => ({
        key: keyOf(source.url),
        url: source.url,
        original: spec.sources[0].url,
        bytes: source.bytes,
        sha256: source.sha256,
      })),
  );
  return [
    ...copies,
    {
      key: keyOf(bundle.url),
      url: bundle.url,
      original: bundle.original,
      bytes: bundle.bytes,
      sha256: bundle.sha256,
    },
    {
      key: keyOf(`${bundle.url}.index.gz`),
      url: `${bundle.url}.index.gz`,
      original: `${bundle.original}.index.gz`,
      bytes: bundle.index.bytes,
      sha256: bundle.index.sha256,
    },
  ];
}

/** Every place a pinned file may be downloaded from, with what it must be. */
export function placesToCheck(toolchains, bundle) {
  return [
    ...toolchains.flatMap((spec) =>
      spec.sources.map((source) => ({
        name: `${spec.name} ${spec.version} from ${source.hosts[0]}`,
        url: source.url,
        bytes: source.bytes,
        sha256: source.sha256,
      })),
    ),
    ...[bundle.original, bundle.url].map((url) => ({
      name: `Tectonic's bundle from ${new URL(url).host}`,
      url,
      bytes: bundle.bytes,
      sha256: bundle.sha256,
    })),
    ...[bundle.original, bundle.url].map((url) => ({
      name: `Tectonic's bundle index from ${new URL(url).host}`,
      url: `${url}.index.gz`,
      bytes: bundle.index.bytes,
      sha256: bundle.index.sha256,
    })),
  ];
}

/** A file's size and SHA-256, read whole as it arrives and kept nowhere unless `into` names a file. */
async function measure(url, into) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`answered HTTP ${response.status}`);
  const hash = createHash("sha256");
  let bytes = 0;
  const counted = async function* (chunks) {
    for await (const chunk of chunks) {
      bytes += chunk.byteLength;
      hash.update(chunk);
      yield chunk;
    }
  };
  await pipeline(
    Readable.fromWeb(response.body),
    counted,
    into
      ? createWriteStream(into)
      : new Writable({ write: (...[, , done]) => done() }),
  );
  return { bytes, sha256: hash.digest("hex") };
}

/** A file's size as its server states it, following redirects. */
async function statedSize(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  if (!response.ok) throw new Error(`answered HTTP ${response.status}`);
  const length = response.headers.get("content-length");
  return length === null ? undefined : Number(length);
}

async function bytesAt(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** The pins, read from the packages that hold them. */
async function loadPins() {
  resolveWorkspaceTypeScript();
  const load = (path) => import(pathToFileURL(join(repository, path)).href);
  const { pinnedToolchains } = await load(
    "packages/feature/toolchains/src/toolchains.ts",
  );
  const { tectonicBundleCopy } = await load(
    "packages/feature/document-compiler/src/latex-packages.ts",
  );
  const { modelListPlaces } = await load(
    "packages/feature/model-client/src/model-list-places.ts",
  );
  return { pinnedToolchains, tectonicBundleCopy, modelListPlaces };
}

async function check(quick) {
  const { pinnedToolchains, tectonicBundleCopy, modelListPlaces } =
    await loadPins();
  let failed = 0;
  const report = (ok, name, said) => {
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${said}`);
  };
  for (const place of placesToCheck(pinnedToolchains, tectonicBundleCopy)) {
    try {
      if (quick) {
        const size = await statedSize(place.url);
        report(
          size === place.bytes,
          place.name,
          size === place.bytes
            ? `${size} bytes`
            : `${size ?? "no"} bytes stated, ${place.bytes} pinned`,
        );
      } else {
        const found = await measure(place.url);
        const ok = found.bytes === place.bytes && found.sha256 === place.sha256;
        report(
          ok,
          place.name,
          ok
            ? `${found.bytes} bytes, SHA-256 as pinned`
            : `${found.bytes} bytes, SHA-256 ${found.sha256}; pinned ${place.bytes} bytes, ${place.sha256}`,
        );
      }
    } catch (error) {
      report(false, place.name, error.message);
    }
  }
  const [github, ...copies] = modelListPlaces;
  for (const copy of copies)
    for (const file of ["list", "signature"])
      try {
        const same = (await bytesAt(github[file])).equals(
          await bytesAt(copy[file]),
        );
        report(
          same,
          `the model list's ${file} on ${copy.name}`,
          same
            ? `the same as on ${github.name}`
            : `not the one on ${github.name}`,
        );
      } catch (error) {
        report(
          false,
          `the model list's ${file} on ${copy.name}`,
          error.message,
        );
      }
  if (failed) {
    console.error(`${failed} place${failed === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }
}

function rclone(args) {
  return execFileSync("rclone", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

async function upload(remote, only) {
  if (!remote || !remote.includes(":"))
    throw new Error("Name the rclone remote and bucket, as remote:bucket.");
  const { pinnedToolchains, tectonicBundleCopy, modelListPlaces } =
    await loadPins();
  const chosen = (key) => !only || key.startsWith(only);
  const folder = await mkdtemp(join(tmpdir(), "zhiyin-mirrors-"));
  try {
    for (const file of copiedFiles(pinnedToolchains, tectonicBundleCopy)) {
      if (!chosen(file.key)) continue;
      const kept = join(folder, "file");
      console.log(`Downloading ${file.original}`);
      const found = await measure(file.original, kept);
      if (found.bytes !== file.bytes || found.sha256 !== file.sha256)
        throw new Error(
          `${file.original} is not the pinned file: ${found.bytes} bytes, SHA-256 ${found.sha256}.`,
        );
      console.log(`Uploading ${file.key}`);
      rclone(["copyto", kept, `${remote}/${file.key}`, "--s3-no-check-bucket"]);
      await rm(kept);
    }
    const [github, copy] = modelListPlaces;
    if (copy && chosen(keyOf(copy.list))) {
      for (const file of ["list", "signature"]) {
        const local = await readFile(
          join(
            modelListFolder,
            file === "list" ? "models.json" : "models.json.sig",
          ),
        );
        if (!local.equals(await bytesAt(github[file])))
          throw new Error(
            `The model list's ${file} here is not the one on GitHub's main branch: merge it before uploading.`,
          );
      }
      for (const file of ["list", "signature"])
        rclone([
          "copyto",
          join(
            modelListFolder,
            file === "list" ? "models.json" : "models.json.sig",
          ),
          `${remote}/${keyOf(copy[file])}`,
          "--s3-no-check-bucket",
          // A newer list reaches apps as soon as it is uploaded.
          "--header-upload",
          "Cache-Control: no-cache",
        ]);
      console.log("Uploaded the model list.");
    }
    const read = new Set(
      copiedFiles(pinnedToolchains, tectonicBundleCopy).map((file) => file.key),
    );
    const unused = rclone(["lsf", "-R", "--files-only", `${remote}/toolchains`])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => `toolchains/${path}`)
      .filter((key) => !read.has(key));
    if (unused.length)
      console.log(
        `Copies this build does not read, to remove once no supported build reads them:\n${unused.join("\n")}`,
      );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "check") await check(rest.includes("--quick"));
    else if (command === "upload") {
      const at = rest.indexOf("--only");
      await upload(rest[0], at >= 0 ? rest[at + 1] : undefined);
    } else {
      console.error(
        "Usage: node scripts/mirrors.mjs check [--quick] | upload <remote:bucket> [--only <prefix>]",
      );
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
