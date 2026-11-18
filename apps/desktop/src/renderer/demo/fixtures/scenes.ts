/**
 * A 3D scene for the lab and the demo: a mug built and previewed by the real
 * session script in Blender, kept as JPEGs, so the panel shows what Blender
 * actually draws rather than a grey rectangle.
 */

import type { ScenePanelState, ScenePreview } from "@zhiyin/contract";
import camera from "./sample-scene-camera.jpg?inline";
import overview from "./sample-scene-overview.jpg?inline";

const picture = (
  url: string,
  view: ScenePreview["view"],
  sequence: number,
): ScenePreview => ({
  data: url.slice(url.indexOf(",") + 1),
  width: 1120,
  height: 630,
  view,
  sequence,
});

export const sceneThroughCamera: ScenePanelState = {
  status: "open",
  file: "products/mug.blend",
  view: "camera",
  working: false,
  preview: picture(camera, "camera", 1),
};

export const sceneTurned: ScenePanelState = {
  ...sceneThroughCamera,
  view: "overview",
  working: true,
  preview: picture(overview, "overview", 2),
};

export const sceneWithoutCamera: ScenePanelState = {
  ...sceneThroughCamera,
  preview: picture(overview, "overview", 3),
};

export const sceneEmpty: ScenePanelState = {
  ...sceneThroughCamera,
  file: "products/new.blend",
  view: "overview",
  // Blender's picture of an empty scene is never shown, so any picture does.
  preview: { ...picture(overview, "overview", 4), empty: true },
};

export const sceneStarting: ScenePanelState = {
  status: "starting",
  file: "products/mug.blend",
  view: "camera",
  working: false,
};

export const sceneStopped: ScenePanelState = {
  status: "failed",
  file: "products/mug.blend",
  view: "camera",
  working: false,
  reason: "Blender stopped unexpectedly.",
};
