/**
 * A Python environment for one-off data work, offered as a built-in
 * connector. It is `uv`-managed and kept apart from a person's own projects:
 * every `uv` command runs in the sandbox folder, so nothing in the workspace
 * decides what the sandbox contains.
 *
 * Boundaries and invariants: docs/architecture/features/python-sandbox/README.md
 */

export * from "./python-sandbox.js";

export type {
  ProcessContainer as ProgramContainer,
  ProcessContainment as ProgramContainment,
  ProcessRun as ProgramRun,
  RunProcess as RunProgram,
} from "@zhiyin/process-ownership";
