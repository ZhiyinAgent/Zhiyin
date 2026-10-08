/**
 * The built-in actions the agent can take. Each tool takes typed arguments,
 * performs one action, and returns a typed result. It decides nothing about
 * whether it is allowed to run and renders nothing itself.
 *
 * Boundaries and invariants: docs/architecture/features/tools/README.md
 */

export * from "./tools.js";

export type { ConversationItems, FileRead } from "./conversation-items.js";
export type { CommandContainer, CommandContainment } from "./run-command.js";
export type { RecycleBin } from "./delete-file.js";
export { checkRecyclable } from "./recycle-check.js";

export { CanvasPictureFitting } from "./fit-picture.js";
export type { OpenedPdf, PdfPagesSource } from "./read-pdf.js";
