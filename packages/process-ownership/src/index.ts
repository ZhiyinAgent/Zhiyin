/**
 * Structural containment for processes Zhiyin starts.
 */

export * from "./process-ownership.js";

export type {
  ContainedProcess,
  ContainedProcessOptions,
  ContainerOptions,
  ProcessPipes,
  ContainmentAvailability,
  ProcessContainer,
} from "./windows.js";
export {
  ansiCodePage,
  ansiText,
  containmentAvailability,
  openProcessContainer,
} from "./windows.js";
export type { Confined, Confinement } from "./confinement.js";
export { confine, forgetConfinement } from "./confinement.js";
export type { HeldFile, HoldAttempt } from "./file-lock.js";
export { holdExclusively } from "./file-lock.js";
export { printedText } from "./output.js";
export { windowsEnvironment } from "./windows-environment.js";
