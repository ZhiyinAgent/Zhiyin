/**
 * The built-in actions the agent can take. Each tool takes typed arguments,
 * performs one action, and returns a typed result. It decides nothing about
 * whether it is allowed to run and renders nothing itself.
 */

export * from "./tools.js";
export type { ToolRegistry, ToolResult } from "./tool-registry.js";
export type {
  CommandEnded,
  CommandsChanged,
  JobChanges,
  ShellCommands,
} from "./commands/shell-commands.js";

export type { ConversationItems } from "./shared/conversation-items.js";
export type {
  CommandContainer,
  CommandContainment,
} from "./commands/run-command.js";
export type { RecycleBin } from "@zhiyin/files";
export type { ConversationReach, ShellReach } from "./commands/reach.js";
export { packageRegistries } from "./commands/reach.js";
export type {
  SealedShellSetup,
  SealedToolchain,
} from "./commands/sealed-shell.js";
export type {
  ShellGit,
  ShellGitAnswer,
  ShellGitCall,
} from "./commands/git-handoff.js";

export {
  CanvasPictureFitting,
  type ShrinkPicture,
} from "./documents/fit-picture.js";
export type {
  OpenedPixels,
  PixelFormat,
  PixelSource,
} from "./documents/picture-pixels.js";
export type { OpenedPdf, PdfPagesSource } from "./documents/read-pdf.js";
