#!/usr/bin/env node
/**
 * Keys for Zhiyin's model list, and the signature an installed app checks
 * before it takes a newer list (ADR 0031; how to use it: docs/tooling.md,
 * "Model list").
 *
 *   node scripts/model-list.mjs keys <folder outside the repository>
 *     Makes the primary and the backup Ed25519 key, each a passphrase-encrypted
 *     PKCS#8 file in that folder, and prints the public halves to paste into
 *     packages/model-client/src/model-list-keys.ts.
 *
 *   node scripts/model-list.mjs sign <private key file>
 *     Fetches main, raises the version of
 *     packages/model-client/model-list/models.json above the last signed one
 *     there (setting `published` to today) if it is not already, signs the
 *     file as it is on disk and writes models.json.sig beside it.
 */

import { execFileSync } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = join(
  repository,
  "packages/model-client/model-list/models.json",
);
const published = "packages/model-client/model-list/models.json";

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Reads a line from the terminal without showing what is typed. */
function hidden(prompt) {
  return new Promise((done) => {
    const input = process.stdin;
    if (!input.isTTY) fail("Run this in a terminal: it asks for a passphrase.");
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let typed = "";
    const onData = (chunk) => {
      // A terminal wraps pasted text in bracketed-paste markers.
      const text = chunk
        .replaceAll("\u001b[200~", "")
        .replaceAll("\u001b[201~", "");
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          input.setRawMode(false);
          input.pause();
          input.off("data", onData);
          process.stdout.write("\n");
          done(typed);
          return;
        }
        if (character === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (character === "\u0008" || character === "\u007f")
          typed = typed.slice(0, -1);
        else if (character >= " ") typed += character;
      }
    };
    input.on("data", onData);
  });
}

async function keys(folder) {
  if (!folder) fail("Name the folder to keep the keys in.");
  const into = resolve(folder);
  const inside = relative(repository, into);
  if (!inside.startsWith("..") && !inside.includes(":"))
    fail("Keep the keys outside the repository, where Git never sees them.");
  if (!existsSync(into)) fail(`${into} does not exist.`);
  const month = new Date().toISOString().slice(0, 7);
  const ids = [`primary-${month}`, `backup-${month}`];
  for (const id of ids)
    if (existsSync(join(into, `${id}.pem`)))
      fail(`${join(into, `${id}.pem`)} exists already; nothing was made.`);
  const passphrase = await hidden("Passphrase for both keys: ");
  if (passphrase.length < 12)
    fail("Use a passphrase of 12 characters or more.");
  if ((await hidden("The same passphrase again: ")) !== passphrase)
    fail("The two passphrases differ; nothing was made.");
  console.log(
    "\nPaste these into packages/model-client/src/model-list-keys.ts:\n",
  );
  for (const id of ids) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase,
      },
    });
    writeFileSync(join(into, `${id}.pem`), privateKey, { flag: "wx" });
    console.log(`  "${id}": "${publicKey.toString("base64")}",`);
  }
  console.log(
    `\nThe private keys are in ${into}. Copy the backup key somewhere apart from it (docs/tooling.md, "Model list").`,
  );
}

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
  const pem = readFileSync(keyFile);
  const passphrase = await hidden(`Passphrase for ${basename(keyFile)}: `);
  let key;
  try {
    key = createPrivateKey({ key: pem, passphrase });
  } catch {
    fail(
      `That passphrase does not open ${basename(keyFile)}; nothing was signed.`,
    );
  }
  const signature = sign(null, bytes, key);
  if (!verify(null, bytes, createPublicKey(key), signature))
    fail("The signature does not verify; nothing was written.");
  writeFileSync(
    `${listPath}.sig`,
    `${JSON.stringify({
      key: basename(keyFile).replace(/\.pem$/, ""),
      version,
      signature: signature.toString("base64"),
    })}\n`,
  );
  console.log(
    `Signed version ${version}: ${relative(repository, listPath)}.sig`,
  );
}

const [command, argument] = process.argv.slice(2);
if (command === "keys") await keys(argument);
else if (command === "sign") await signList(argument);
else fail("Use: node scripts/model-list.mjs keys <folder> | sign <key file>");
