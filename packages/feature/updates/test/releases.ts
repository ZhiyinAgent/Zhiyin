/**
 * Releases for the tests: an installer's bytes written to a folder, its
 * signature made with a key the test holds, and places that serve them.
 */

import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdatePlace, UpdateSource } from "../src/index.js";
import { signatureAddress } from "../src/update-places.js";
import { signedText, type SignedRelease } from "../src/release-signature.js";

export type Key = {
  readonly id: string;
  readonly secret: KeyObject;
  readonly spki: string;
};

export function keyPair(id = "release-primary"): Key {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    id,
    secret: privateKey,
    spki: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

export function releaseOf(version: string, bytes: Buffer): SignedRelease {
  return {
    version,
    file: `Zhiyin-Setup-${version}.exe`,
    size: bytes.byteLength,
    sha512: createHash("sha512").update(bytes).digest("base64"),
  };
}

/** The signature file a maintainer would publish beside the installer. */
export function signatureFile(
  release: SignedRelease,
  key: Key,
  fields: Partial<SignedRelease> = {},
): string {
  const signed = { ...release, ...fields };
  return JSON.stringify({
    key: key.id,
    ...signed,
    signature: sign(
      null,
      Buffer.from(signedText(signed), "utf8"),
      key.secret,
    ).toString("base64"),
  });
}

export const github: UpdatePlace = {
  name: "GitHub",
  kind: "github",
  owner: "ZhiyinAgent",
  repository: "Zhiyin",
};

export const copy: UpdatePlace = {
  name: "media.zhiyinagent.app",
  kind: "folder",
  url: "https://media.test/releases/",
};

/** What one place offers: its newest release, the installer, its signature. */
export type Offering = {
  readonly release?: SignedRelease;
  /** The installer's bytes as this place sends them. */
  readonly installer?: Buffer;
  /** The signature file's text; none when the place has no signature. */
  readonly signature?: string;
  /** The place cannot be reached at all. */
  readonly unreachable?: boolean;
  /** The place never says what it offers. */
  readonly silent?: boolean;
  /** The download never ends until it is stopped. */
  readonly stalls?: boolean;
};

/**
 * A source and a network over places the test sets, keeping a record of
 * what was asked, so a test can say nothing large was downloaded.
 */
export function placesServing(
  folder: string,
  offerings: Map<UpdatePlace, Offering>,
) {
  const asked: string[] = [];
  const downloads: string[] = [];
  const installed: string[] = [];
  let downloaded = 0;
  const source: UpdateSource = {
    async look(place, signal) {
      asked.push(`look ${place.name}`);
      const offering = offerings.get(place) ?? {};
      if (offering.unreachable) throw new Error("ENOTFOUND");
      if (offering.silent)
        await new Promise((_, refuse) =>
          signal.addEventListener("abort", () => refuse(new Error("aborted"))),
        );
      return offering.release;
    },
    async download(place, release, progress, signal) {
      downloads.push(`${place.name} ${release.version}`);
      const offering = offerings.get(place) ?? {};
      if (offering.stalls)
        await new Promise((_, refuse) =>
          signal.addEventListener("abort", () => refuse(new Error("aborted"))),
        );
      progress(0.5);
      const path = join(folder, `download-${(downloaded += 1)}.exe`);
      await writeFile(path, offering.installer ?? Buffer.alloc(0));
      progress(1);
      return path;
    },
    install(path) {
      installed.push(path);
    },
  };
  const network = async (url: string): Promise<Response> => {
    asked.push(`get ${url}`);
    for (const [place, offering] of offerings) {
      if (!offering.release) continue;
      if (signatureAddress(place, offering.release) !== url) continue;
      if (offering.unreachable) throw new TypeError("fetch failed");
      return offering.signature === undefined
        ? new Response("Not Found", { status: 404 })
        : new Response(offering.signature);
    }
    return new Response("Not Found", { status: 404 });
  };
  return { source, network, asked, downloads, installed };
}
