import { ScenePanel } from "../../ui/scene/index.js";
import {
  sceneEmpty,
  sceneStarting,
  sceneStopped,
  sceneThroughCamera,
  sceneTurned,
  sceneWithoutCamera,
} from "../fixtures/scenes.js";
import type { ComponentCatalogEntry } from "./entry.js";

export const sceneEntries: ComponentCatalogEntry[] = [
  {
    id: "scene-view",
    title: "The 3D view",
    description:
      "Beside the conversation while the agent works on a Blender scene. Each change arrives as a new picture over the last one; the person looks through the scene's camera or turns an overview by dragging.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-scene-surface">
        <ScenePanel scene={sceneThroughCamera} onLook={() => undefined} />
      </div>
    ),
  },
  {
    id: "scene-view-states",
    title: "The 3D view, turned, without a camera, empty, starting and stopped",
    description:
      "The overview while Blender works, a scene with no camera yet, a scene with nothing in it, Blender starting, and Blender stopped, which says the scene comes back from its file.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-scene-states">
        {[
          sceneTurned,
          sceneWithoutCamera,
          sceneEmpty,
          sceneStarting,
          sceneStopped,
        ].map((scene, index) => (
          <div
            key={index}
            className="lab-feature-surface lab-scene-surface lab-scene-surface--state"
          >
            <ScenePanel scene={scene} onLook={() => undefined} />
          </div>
        ))}
      </div>
    ),
  },
];
