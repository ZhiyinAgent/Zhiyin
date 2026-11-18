import styles from "./beside.module.css";

export type Surface = "browser" | "document" | "3d";

/** A surface's name in the window: on its switch, its tab and its notice. */
export const surfaceNames: Readonly<Record<Surface, string>> = {
  browser: "Browser",
  document: "Document",
  "3d": "3D view",
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
      className={styles["beside-switch"]}
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
          {surfaceNames[surface]}
        </button>
      ))}
    </div>
  );
}
