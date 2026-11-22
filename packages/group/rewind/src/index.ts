/**
 * Going back to an earlier message, together with the files the conversation
 * changed since.
 *
 * The conversation planner decides what a rewind removes; file recovery keeps
 * copies of what file changes overwrote and puts them back. This group joins
 * the two: it binds a plan to its file review, keeps that pair until it is
 * applied or replaced, and says when files are being put back. The backups
 * around each change are recovery's own, handed to the agent loop as they
 * are; their types are named here, the loop's way to them. Each member keeps
 * its own rules and storage (ADR 0002).
 */

export * from "./rewind.js";
export type {
  FileBackups,
  RunBackup,
  RunBackups,
  RunStart,
  TurnFiles,
} from "@zhiyin/recovery";
