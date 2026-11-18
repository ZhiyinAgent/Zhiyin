/**
 * What tests share: temporary folders removed after each test, waits woken by
 * what the code under test does, never by a clock, and files held open the way
 * another program holds them.
 */

export { TemporaryFolders } from "./temporary-folders.js";
export { changed, until, watched } from "./waits.js";
export { holdOpen } from "./file-holds.js";
