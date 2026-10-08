import styles from "./workspace.module.css";

export type Surface = "browser" | "document";

/**
 * The choice between the browser and a document, offered when a conversation
 * has both. Choosing one hides the other; neither is closed.
 */
export function SurfaceSwitch({
  selected,
  onSelect,
}: {
  selected: Surface;
  onSelect: (surface: Surface) => void;
}) {
  return (
    <div
      className={styles["workspace-switch"]}
      role="group"
      aria-label="Show beside the conversation"
    >
      {(["browser", "document"] as const).map((surface) => (
        <button
          key={surface}
          type="button"
          aria-pressed={selected === surface}
          onClick={() => onSelect(surface)}
        >
          {surface === "browser" ? "Browser" : "Document"}
        </button>
      ))}
    </div>
  );
}
