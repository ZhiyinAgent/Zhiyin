/**
 * Runs a turn: send the conversation to a model, get each proposed action
 * decided by the permission engine, execute the approved ones, feed results
 * back, repeat until the turn ends. A turn may end while a delegated
 * specialist keeps running in the background; when that specialist settles,
 * this wakes the task with a fresh, automatic turn to receive it.
 *
 * This package owns the order of steps and nothing about how any step is
 * performed. If a change here needs to know which tool it is calling, which
 * MCP server is behind it, or what a skill contains, the change belongs in
 * that feature instead.
 *
 * Boundaries and invariants: docs/architecture/features/agent-loop/README.md
 */

export * from "./agent-loop.js";

export { TurnOwnership } from "./turn/turn-ownership.js";
export { WorkLedger, type WorkLimits } from "./turn/work-limits.js";
export type { AgentLoopDependencies, TurnHost } from "./dependencies.js";
