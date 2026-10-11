import styles from "./workspace.module.css";

export type Surface = "browser" | "document" | "scene";

const labels: Record<Surface, string> = {
  browser: "Browser",
  document: "Document",
  scene: "3D view",
};

/**
 * The choice between the surfaces a conversation has, offered when it has
 * more than one. Choosing one hides the others; none is closed.
 */
export function SurfaceSwitch({
  available,
  selected,
  onSelect,
}: {
  available: readonly Surface[];
  selected: Surface;
  onSelect: (surface: Surface) => void;
}) {
  return (
    <div
      className={styles["workspace-switch"]}
      role="group"
      aria-label="Show beside the conversation"
    >
      {available.map((surface) => (
        <button
          key={surface}
          type="button"
          aria-pressed={selected === surface}
          onClick={() => onSelect(surface)}
        >
          {labels[surface]}
        </button>
      ))}
    </div>
  );
}
