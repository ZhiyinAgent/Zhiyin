import type { SceneIntent, ScenePanelState } from "@zhiyin/contract";
import { ScenePanel } from "./ScenePanel.js";
import styles from "./scene.module.css";

/**
 * The 3D view as the workspace beside the conversation shows it: the panel
 * filling the space, and a way back when Blender stopped.
 */
export function SceneSurface({
  scene,
  agentWorking = false,
  onLook,
  onReturn,
}: {
  scene: ScenePanelState;
  agentWorking?: boolean;
  onLook: (intent: SceneIntent) => void | Promise<void>;
  onReturn: () => void;
}) {
  return (
    <div className={styles["scene-workspace"]}>
      <ScenePanel scene={scene} agentWorking={agentWorking} onLook={onLook} />
      {scene.status === "failed" && (
        <button
          className={`text-button ${styles["scene-workspace__return"]}`}
          type="button"
          onClick={onReturn}
        >
          Return to conversation
        </button>
      )}
    </div>
  );
}
