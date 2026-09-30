/**
 * Typst and LaTeX compilation, offered as one built-in connector: one tool
 * that turns a document in the workspace into a PDF and reports what the
 * compiler said about it.
 *
 * Boundaries and invariants: docs/architecture/features/document-compiler/README.md
 */

export * from "./document-compiler.js";

export type {
  ProcessContainer as ProgramContainer,
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
