import { PartPanel } from "../../ui/parts/index.js";
import {
  brokenBracket,
  gearTrain,
  plateAndPin,
  sampleModel,
} from "../fixtures/parts.js";
import type { ComponentCatalogEntry } from "./entry.js";

/** The 3D view's frame in a conversation with a Blender scene and parts. */
const withScene = (current: "scene" | "parts") => ({
  label: "3D view",
  menu: {
    label: "In 3D",
    listLabel: "What the 3D view can show",
    items: [
      { id: "scene", name: "workshop.blend", detail: "Blender scene" },
      { id: "parts", name: "mounting-plate.py", detail: "Parts built" },
    ],
    current,
    onPick: () => undefined,
  },
  close: { label: "Put the 3D view away", onClose: () => undefined },
});

export const partsEntries: ComponentCatalogEntry[] = [
  {
    id: "part-view",
    title: "The 3D view, showing parts built",
    description:
      "Beside the conversation once the CAD studio builds: the parts in 3D, each its own tone with its edges drawn, turned by dragging or the arrow keys and zoomed by scrolling, and listed with their sizes. With a Blender scene too, the menu offers it.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-feature-surface lab-scene-surface">
        <PartPanel
          parts={plateAndPin}
          loadModel={sampleModel}
          frame={withScene("parts")}
        />
      </div>
    ),
  },
  {
    id: "part-view-states",
    title: "The 3D view's parts, drawing, unable to draw, and failed",
    description:
      "A build whose mesh has not arrived yet; a computer that cannot draw 3D, where the sizes of a build of sixty parts take the drawing's room; and a mesh that could not be drawn. The last two list a part that is not a valid solid, and a name too long for one line.",
    className: "lab-section--feature",
    render: () => (
      <div className="lab-scene-states">
        <div className="lab-feature-surface lab-scene-surface lab-scene-surface--state">
          <PartPanel
            parts={plateAndPin}
            loadModel={() => new Promise(() => undefined)}
          />
        </div>
        <div className="lab-feature-surface lab-scene-surface lab-scene-surface--state">
          <PartPanel
            parts={gearTrain}
            loadModel={sampleModel}
            createView={() => {
              throw new Error("WebGL is not available.");
            }}
          />
        </div>
        <div className="lab-feature-surface lab-scene-surface lab-scene-surface--state">
          <PartPanel
            parts={brokenBracket}
            loadModel={async (sequence) => ({
              sequence,
              data: new Uint8Array([1, 2, 3]),
            })}
          />
        </div>
      </div>
    ),
  },
];
