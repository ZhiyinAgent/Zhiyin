/**
 * The maintainers' signing keys, shared by the model list's script and the
 * release script: making a primary and a backup Ed25519 key, each a
 * passphrase-encrypted PKCS#8 file kept outside the repository, and opening
 * one to sign with. Keys for different purposes are made apart, so a key that
 * signs one thing never signs another.
 */

import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Reads a line from the terminal without showing what is typed. */
export function hidden(prompt) {
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

/**
 * Makes a primary and a backup key in a folder outside the repository, named
 * `<prefix>primary-<month>` and `<prefix>backup-<month>`, and prints their
 * public halves to paste into `target`.
 */
export async function makeKeys(folder, { prefix = "", target }) {
  if (!folder) fail("Name the folder to keep the keys in.");
  const into = resolve(folder);
  const inside = relative(repository, into);
  if (!inside.startsWith("..") && !inside.includes(":"))
    fail("Keep the keys outside the repository, where Git never sees them.");
  if (!existsSync(into)) fail(`${into} does not exist.`);
  const month = new Date().toISOString().slice(0, 7);
  const ids = [`${prefix}primary-${month}`, `${prefix}backup-${month}`];
  for (const id of ids)
    if (existsSync(join(into, `${id}.pem`)))
      fail(`${join(into, `${id}.pem`)} exists already; nothing was made.`);
  const passphrase = await hidden("Passphrase for both keys: ");
  if (passphrase.length < 12)
    fail("Use a passphrase of 12 characters or more.");
  if ((await hidden("The same passphrase again: ")) !== passphrase)
    fail("The two passphrases differ; nothing was made.");
  console.log(`\nPaste these into ${target}:\n`);
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
    `\nThe private keys are in ${into}. Copy the backup key somewhere apart from it.`,
  );
}

/** Asks for the passphrase and opens the key; its id is the file's name. */
export async function openKey(keyFile) {
  if (!keyFile) fail("Name the private key file to sign with.");
  const pem = readFileSync(keyFile);
  const passphrase = await hidden(`Passphrase for ${basename(keyFile)}: `);
  try {
    return {
      id: basename(keyFile).replace(/\.pem$/, ""),
      key: createPrivateKey({ key: pem, passphrase }),
    };
  } catch {
    fail(
      `That passphrase does not open ${basename(keyFile)}; nothing was signed.`,
    );
  }
}
