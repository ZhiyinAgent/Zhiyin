/**
 * Fetches the font the app draws Chinese, Japanese and Korean text with, when
 * a document names a font for it without embedding one, into
 * `apps/desktop/fonts`, where the build packs it into the app. It is fetched
 * from the commit `apps/desktop/fonts.json` names and kept only if its SHA-256
 * is the one listed there. One already here and correct is not fetched again.
 * ADR 0024.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { download, fetchVerified } from "./verified-files.mjs";

const desktop = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const { fallback } = JSON.parse(
  await readFile(join(desktop, "fonts.json"), "utf8"),
);
await fetchVerified({
  files: [fallback],
  folder: join(desktop, "fonts"),
  download,
});
console.log(`${fallback.name} in place.`);
