import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { pdfDocumentOptions } from "../src/index.js";

const require = createRequire(import.meta.url);
const build = join(
  dirname(require.resolve("pdfjs-dist/package.json")),
  "legacy",
  "build",
);

describe("the PDF engine", () => {
  // CVE-2024-4367: a crafted font made pdf.js run text from the document as
  // code, through `new Function`, where evaluation was allowed. The version in
  // use has no such path at all, so there is no option to turn it off; this
  // fails if an upgrade brings one back.
  it("carries no way to run text from a document as code", async () => {
    for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
      const source = await readFile(join(build, file), "utf8");
      expect(source, file).not.toMatch(/new Function\s*\(/);
      expect(source, file).not.toMatch(/(?<![\w.$])eval\s*\(/);
    }
  });

  it("opens a document without the network, system fonts or font faces, and with a bound on images", () => {
    const options = pdfDocumentOptions(new Uint8Array([1, 2, 3]));
    expect(options).toMatchObject({
      useSystemFonts: false,
      disableFontFace: true,
      maxImageSize: expect.any(Number),
    });
    expect(String(options["standardFontDataUrl"])).toMatch(
      /standard_fonts[\\/]$/,
    );
  });
});
