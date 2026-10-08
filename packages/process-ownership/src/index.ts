/**
 * Structural containment for processes Zhiyin starts.
 *
 * Boundaries and invariants:
 * docs/architecture/features/process-ownership/README.md
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
export { containmentAvailability, openProcessContainer } from "./windows.js";
export type { HeldFile, HoldAttempt } from "./file-lock.js";
export { holdExclusively } from "./file-lock.js";
