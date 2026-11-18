/**
 * The signature beside each installer (ADR 0027): the key that signed, the
 * release it names, and the signature over that release's signed text. The
 * signing script and the app build the signed text the same way, here.
 */

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { compareVersions, isVersion } from "./versions.js";

/** What a signature says about one installer. */
export type SignedRelease = {
  readonly version: string;
  /** The installer's file name, as published. */
  readonly file: string;
  readonly size: number;
  /** The installer's SHA-512, base64, as electron-builder writes it. */
  readonly sha512: string;
};

export type ReleaseSignature = SignedRelease & {
  /** The id of the key that signed, as the app ships it. */
  readonly key: string;
  /** Ed25519, base64, over the release's signed text. */
  readonly signature: string;
};

/** Why a release was not taken, in words the person can read. */
export class NotUsable extends Error {}

/** A signature file is a few hundred bytes; anything larger is not one. */
export const LARGEST_SIGNATURE_FILE = 4_096;

const fileName = /^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/;
const sha512 = /^[A-Za-z0-9+/]{86}==$/;
const fields = ["file", "key", "sha512", "signature", "size", "version"];

/**
 * The exact text a key signs for a release. It names what it is first, so
 * no signature made for anything else can verify as a release's.
 */
export function signedText(release: SignedRelease): string {
  return [
    "Zhiyin installer",
    "format: 1",
    `version: ${release.version}`,
    `file: ${release.file}`,
    `size: ${release.size}`,
    `sha512: ${release.sha512}`,
    "",
  ].join("\n");
}

/** Whether a release's fields are in the form a signature may name. */
export function wellFormed(release: SignedRelease): boolean {
  return (
    isVersion(release.version) &&
    fileName.test(release.file) &&
    Number.isSafeInteger(release.size) &&
    release.size > 0 &&
    sha512.test(release.sha512)
  );
}

/** Reads a signature file, refusing anything but its closed set of fields. */
export function readReleaseSignature(text: string): ReleaseSignature {
  const unreadable = new NotUsable("The release's signature is unreadable.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw unreadable;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw unreadable;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== fields.join()) throw unreadable;
  const { key, signature, version, file, size, sha512: hash } = record;
  if (
    typeof key !== "string" ||
    typeof signature !== "string" ||
    typeof version !== "string" ||
    typeof file !== "string" ||
    typeof size !== "number" ||
    typeof hash !== "string"
  )
    throw unreadable;
  const read = { key, signature, version, file, size, sha512: hash };
  if (!wellFormed(read)) throw unreadable;
  return read;
}

/** The keys a release may be signed with, from their shipped form. */
export function releaseKeysOf(
  keys: Readonly<Record<string, string>>,
): ReadonlyMap<string, KeyObject> {
  return new Map(
    Object.entries(keys).map(([id, spki]) => {
      const key = createPublicKey({
        key: Buffer.from(spki, "base64"),
        format: "der",
        type: "spki",
      });
      if (key.asymmetricKeyType !== "ed25519")
        throw new Error(`The release key "${id}" is not an Ed25519 key.`);
      return [id, key] as const;
    }),
  );
}

/**
 * Holds when a shipped key signed exactly this release, and it is the one
 * offered and newer than the version running.
 */
export function checkSignature(
  signature: ReleaseSignature,
  offered: SignedRelease,
  running: string,
  keys: ReadonlyMap<string, KeyObject>,
): void {
  const key = keys.get(signature.key);
  if (!key)
    throw new NotUsable(
      "The release is signed with a key this version does not know.",
    );
  if (
    !verify(
      null,
      Buffer.from(signedText(signature), "utf8"),
      key,
      Buffer.from(signature.signature, "base64"),
    )
  )
    throw new NotUsable("The release's signature does not match it.");
  if (signature.version !== offered.version)
    throw new NotUsable(
      `The release offered is ${offered.version}, but its signature names ${signature.version}.`,
    );
  if (compareVersions(signature.version, running) <= 0)
    throw new NotUsable(
      `The release offered, ${signature.version}, is not newer than this version.`,
    );
  if (
    signature.file !== offered.file ||
    signature.size !== offered.size ||
    signature.sha512 !== offered.sha512
  )
    throw new NotUsable(
      "The installer offered is not the one the release's signature names.",
    );
}
