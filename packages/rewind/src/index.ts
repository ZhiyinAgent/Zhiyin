/**
 * Going back to an earlier message, together with the files the conversation
 * changed since.
 *
 * The conversation planner decides what a rewind removes; file recovery keeps
 * copies of what file changes overwrote and puts them back. This group joins
 * the two: it binds a plan to its file review, keeps that pair until it is
 * applied or replaced, says when files are being put back, and takes the
 * backups around each file change. Each member keeps its own rules and storage
 * (ADR 0002).
 *
 * Boundaries and invariants: docs/architecture/features/rewind/README.md
 */

export * from "./rewind.js";
