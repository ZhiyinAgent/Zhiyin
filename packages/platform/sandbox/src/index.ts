/**
 * Structural containment for processes Zhiyin starts.
 */

export * from "./process-runs.js";
export { removeUnusedContainers } from "./container-sweep.js";

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
export { mayGrantFolder } from "./folder-grants.js";
export { holdingContainer } from "./container-holds.js";
export type { ProxyRoute } from "./egress/dial.js";
export type { FurtherHosts, HostReach } from "./egress/host-proxy.js";
export type { ShownPort } from "./egress/shown-ports.js";
export type { LoopbackProxy } from "./egress/loopback-proxy.js";
export { openLoopbackProxy } from "./egress/loopback-proxy.js";
export type { PipeOpening } from "./pipe-openings.js";
export { hostList, hostListProblem } from "./egress/hosts.js";
export { printedText } from "./output.js";
export { windowsEnvironment } from "./windows-environment.js";
export type {
  HeldPath,
  HoldKind,
  ReadOnlyHold,
  ReadOnlyHolds,
} from "./read-only-holds.js";
export { readOnlyHolds } from "./read-only-holds.js";
export type { Opening, WindowsFiles } from "./windows-files.js";
export { windowsFiles } from "./windows-files.js";
