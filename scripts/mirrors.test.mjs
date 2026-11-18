/**
 * What the mirror scripts upload and check, against the addresses the app
 * reads: a copy the app reads that the upload leaves out would answer 404 to
 * everyone who needs it.
 */

import { describe, expect, it } from "vitest";
import { pinnedToolchains } from "@zhiyin/toolchains";
import { copiedFiles, keyOf, placesToCheck } from "./mirrors.mjs";

const onZhiyinsHost = (url) => new URL(url).host === "media.zhiyinagent.app";

/** A copy of Tectonic's bundle, as the document compiler pins it. */
const tectonicBundleCopy = {
  url: "https://media.zhiyinagent.app/toolchains/tectonic-bundle/1/bundle.tar",
  original: "https://bundles.test/bundle.tar",
  bytes: 3_000_000_000,
  sha256: "a".repeat(64),
  index: { bytes: 1_000_000, sha256: "b".repeat(64) },
};

describe("Zhiyin's copies", () => {
  it("include every file the app reads from Zhiyin's host, each held to its original's size and fingerprint", () => {
    const copies = copiedFiles(pinnedToolchains, tectonicBundleCopy);
    const read = [
      ...pinnedToolchains.flatMap((spec) =>
        spec.sources.filter((source) => onZhiyinsHost(source.url)),
      ),
      tectonicBundleCopy,
    ].map((file) => file.url);

    for (const url of read)
      expect(copies.map((copy) => copy.url)).toContain(url);
    expect(copies.map((copy) => copy.url)).toContain(
      `${tectonicBundleCopy.url}.index.gz`,
    );
    for (const spec of pinnedToolchains)
      for (const source of spec.sources.filter((each) =>
        onZhiyinsHost(each.url),
      ))
        expect(copies.find((copy) => copy.url === source.url)).toMatchObject({
          original: spec.sources[0].url,
          bytes: spec.sources[0].bytes,
          sha256: spec.sources[0].sha256,
        });
  });

  it("are uploaded under the path the app reads them at", () => {
    expect(
      keyOf(
        "https://media.zhiyinagent.app/toolchains/tectonic/0.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip",
      ),
    ).toBe(
      "toolchains/tectonic/0.17.0/tectonic-0.17.0-x86_64-pc-windows-msvc.zip",
    );
    expect(() => keyOf("https://github.com/typst/typst/x.zip")).toThrow();
  });
});

describe("the check of every place", () => {
  it("asks every source of every pin, and the bundle and its index from both places", () => {
    const urls = placesToCheck(pinnedToolchains, tectonicBundleCopy).map(
      (place) => place.url,
    );

    for (const spec of pinnedToolchains)
      for (const source of spec.sources) expect(urls).toContain(source.url);
    for (const url of [tectonicBundleCopy.original, tectonicBundleCopy.url]) {
      expect(urls).toContain(url);
      expect(urls).toContain(`${url}.index.gz`);
    }
  });
});
