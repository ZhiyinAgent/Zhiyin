/**
 * Local git as typed, per-operation tools — not the generic shell tool, so a
 * commit's permission prompt can show the real diff and message rather than
 * a bare command string.
 */

export * from "./git-connector.js";

export { resolveGit } from "./resolve-git.js";
export type { GitContainer, GitContainment } from "./run-git.js";
