/**
 * 3D scenes built and rendered in Zhiyin's own Blender, one session per
 * conversation (ADR 0025).
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
export type { SceneAutomationOptions } from "./scene-automation.js";
export { containedSessionLaunch } from "./session-process.js";
export type {
  LaunchSession,
  SessionLaunchOptions,
  SessionProcess,
} from "./session-process.js";
export { compiledBlenderPython } from "./compiled-python.js";
export { studioTools } from "./tools.js";
export type { StudioTool } from "./tools.js";
