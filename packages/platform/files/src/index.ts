/**
 * The person's files on Windows, as several features handle them: replacing
 * one whole, adding a line to a file of lines, the record of which ones a
 * studio wrote, and the Recycle Bin with
 * the check of whether Windows would take a path there.
 */

export { replaceFile, type FileContents } from "./file-replacement.js";
export { appendLine } from "./line-files.js";
export { contentDigest, WrittenFiles } from "./written-files.js";
export type { RecycleBin } from "./recycle-bin.js";
export { checkRecyclable, type RunProgram } from "./recycle-check.js";
