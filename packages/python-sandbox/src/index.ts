/**
 * Python environments for one-off data work, offered as a built-in connector.
 * They are kept apart from a person's own projects: every `uv` command runs in
 * the sandbox folder, so nothing in the workspace decides what an environment
 * contains, and a package the model asks for installs confined to its own.
 */

export type { PackageLock } from "./default-packages.js";
export {
  defaultLock,
  defaultPackages,
  defaultPackagesPublishedBy,
} from "./default-packages.js";
export * from "./python-sandbox.js";

export type {
  ProcessContainer as ProgramContainer,
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
