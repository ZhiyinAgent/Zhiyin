/**
 * 3D scenes built and rendered in Zhiyin's own Blender, one session per
 * conversation (ADR 0022).
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
export { sceneAutomation, scenePrograms } from "./scene-automation.js";
export { sceneReviews, sceneReviewer } from "./scene-reviews.js";
export { sceneLines } from "./scene-lines.js";
export type { SceneAutomationOptions } from "./scene-automation.js";
export { containedSessionLaunch } from "./session-process.js";
export { KeptShaderCaches } from "./shader-caches.js";
export type { KeptShaderCachesOptions } from "./shader-caches.js";
export { nvidiaDriverVersion } from "./graphics-driver.js";
export type {
  LaunchSession,
  SessionLaunchOptions,
  SessionProcess,
} from "./session-process.js";
export { compiledBlenderPython } from "./compiled-python.js";
export { studioTools } from "./tools.js";
export type { StudioTool } from "./tools.js";
