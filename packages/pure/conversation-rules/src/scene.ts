import type { ScenePanelState } from "@zhiyin/contract";

/**
 * Whether a conversation has a 3D scene to show: a file open, or a picture
 * of one. Blender starting for the first time has neither, so nothing offers
 * the 3D view yet; the core and the window both judge by this one rule.
 */
export const sceneToShow = (scene: ScenePanelState): boolean =>
  scene.file !== undefined || scene.preview !== undefined;
