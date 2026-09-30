/**
 * The front desk between the app's window and everything behind it.
 *
 * Every command the window sends arrives here, is checked for shape, and goes
 * to whoever answers it: the workspace, which holds the conversations and the
 * app state around them, or the agent loop, which runs a turn. What the window
 * may not decide for itself is decided here too — which folder may be reopened
 * without a dialog, and when startup is tried again — so the Electron main
 * process only carries messages (ADR 0034).
 *
 * Boundaries and invariants: docs/architecture/features/core/README.md
 */

export * from "./core.js";

export type { ModelSettings } from "./model-settings.js";
export {
  Workspace,
  type WorkspaceDependencies,
  type WorkspaceTurns,
} from "./workspace.js";
