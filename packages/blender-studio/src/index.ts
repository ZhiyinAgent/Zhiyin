/**
 * 3D scenes built and rendered in Zhiyin's own Blender, one session per
 * conversation (ADR 0026).
 *
 * Boundaries and invariants:
 * docs/architecture/features/blender-studio/README.md
 */

export {
  ConversationScenes,
  describeSceneTools,
} from "./conversation-scenes.js";
export type { ConversationScenesOptions } from "./conversation-scenes.js";
export { SceneSession } from "./scene-session.js";
export type {
  SceneCommand,
  SceneOutcome,
  SceneSessionOptions,
} from "./scene-session.js";
export { sceneAutomation } from "./scene-automation.js";
export type {
  SceneAutomation,
  SceneAutomationOptions,
} from "./scene-automation.js";
export { containedSessionLaunch, workspaceOpening } from "./session-process.js";
export type {
  LaunchSession,
  OpenFolder,
  SessionLaunchOptions,
  SessionProcess,
} from "./session-process.js";
export { compiledBlenderPython } from "./compiled-python.js";
export { studioTools } from "./tools.js";
export type { StudioTool } from "./tools.js";
