import type { SceneIntent, ScenePanelState } from "@zhiyin/contract";
import type { FrameParts } from "../shared/index.js";
import { ScenePanel } from "./ScenePanel.js";
import styles from "./scene.module.css";

/**
 * The Blender scene as the 3D view beside the conversation shows it: the panel
 * filling the space, and a way back when Blender stopped.
 */
export function SceneSurface({
  scene,
  agentWorking = false,
  onLook,
  onReturn,
  onDrawn,
  frame,
}: {
  scene: ScenePanelState;
  frame?: FrameParts;
  agentWorking?: boolean;
  onLook: (intent: SceneIntent) => void | Promise<void>;
  onReturn: () => void;
  /** Called once the view is drawn: its first picture whole, or at once with none to wait for. */
  onDrawn?: () => void;
}) {
  return (
    <div className={styles["scene-surface"]}>
      <ScenePanel
        scene={scene}
        agentWorking={agentWorking}
        onLook={onLook}
        onDrawn={onDrawn}
        frame={frame}
      />
      {scene.status === "failed" && (
        <button
          className={`text-button ${styles["scene-surface__return"]}`}
          type="button"
          onClick={onReturn}
        >
          Return to conversation
        </button>
      )}
    </div>
  );
}
