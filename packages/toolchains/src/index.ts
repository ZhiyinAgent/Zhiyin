/**
 * External programs an application connector needs, installed on request:
 * downloaded from a pinned address, verified against a pinned digest, and
 * unpacked into application data. Nothing partial is ever usable.
 *
 * Boundaries and invariants: docs/architecture/features/toolchains/README.md
 */

export * from "./toolchains.js";

export type { ToolchainDownload, ToolchainState } from "@zhiyin/contract";
