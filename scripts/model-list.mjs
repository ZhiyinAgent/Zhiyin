#!/usr/bin/env node
/**
 * Keys for Zhiyin's model list, and the signature an installed app checks
 * before it takes a newer list (ADR 0027; how to use it: docs/maintainers.md,
 * "Model list").
 *
 *   node scripts/model-list.mjs keys <folder outside the repository>
 *     Makes the primary and the backup Ed25519 key, each a passphrase-encrypted
 *     PKCS#8 file in that folder, and prints the public halves to paste into
 *     packages/feature/model-client/src/model-list-keys.ts.
 *
 *   node scripts/model-list.mjs sign <private key file>
 *     Fetches main, raises the version of
 *     packages/feature/model-client/model-list/models.json above the last signed one
 *     there (setting `published` to today) if it is not already, signs the
 *     file as it is on disk and writes models.json.sig beside it.
 */

import { execFileSync } from "node:child_process";
import { createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, makeKeys, openKey } from "./signing-keys.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = join(
  repository,
  "packages/feature/model-client/model-list/models.json",
);
const published = "packages/feature/model-client/model-list/models.json";

const git = (...args) =>
  execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/**
 * The version of the last signed list on GitHub's main. Installed apps take
 * only a signed list, so an unsigned one there was never published.
 */
function signedVersionOnMain() {
  try {
    git("fetch", "--quiet", "origin", "main");
  } catch {
    fail("Could not fetch main from GitHub; nothing was signed.");
  }
  try {
    git("show", `origin/main:${published}.sig`);
    return JSON.parse(git("show", `origin/main:${published}`)).version;
  } catch {
    return 0;
  }
}

/** Sets a top-level field of the list in place, leaving every other byte. */
function withField(text, field, value) {
  const line = new RegExp(`^  "${field}": [^\\n]*,$`, "m");
  if (!line.test(text)) fail(`The list has no top-level "${field}" line.`);
  return text.replace(line, `  "${field}": ${JSON.stringify(value)},`);
}

async function signList(keyFile) {
  if (!keyFile) fail("Name the private key file to sign with.");
  const onMain = signedVersionOnMain();
  let text = readFileSync(listPath, "utf8");
  const { version: current } = JSON.parse(text);
  if (!Number.isSafeInteger(current))
    fail("The list's version is not a whole number.");
  if (current <= onMain) {
    text = withField(text, "version", onMain + 1);
    text = withField(text, "published", new Date().toISOString().slice(0, 10));
    writeFileSync(listPath, text);
    console.log(`Raised the list to version ${onMain + 1}, published today.`);
  }
  const bytes = readFileSync(listPath);
  const { version } = JSON.parse(bytes.toString("utf8"));
  const { id, key } = await openKey(keyFile);
  const signature = sign(null, bytes, key);
  if (!verify(null, bytes, createPublicKey(key), signature))
    fail("The signature does not verify; nothing was written.");
  writeFileSync(
    `${listPath}.sig`,
    `${JSON.stringify({
      key: id,
      version,
      signature: signature.toString("base64"),
    })}\n`,
  );
  console.log(
    `Signed version ${version}: ${relative(repository, listPath)}.sig`,
  );
}

const [command, argument] = process.argv.slice(2);
if (command === "keys")
  await makeKeys(argument, {
    target: "packages/feature/model-client/src/model-list-keys.ts",
  });
else if (command === "sign") await signList(argument);
else fail("Use: node scripts/model-list.mjs keys <folder> | sign <key file>");
