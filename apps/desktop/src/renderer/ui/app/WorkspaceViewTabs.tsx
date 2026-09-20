import { useRef } from "react";
import styles from "./app.module.css";

export function WorkspaceViewTabs({
  id,
  selected,
  live = false,
  onSelect,
}: {
  id: string;
  selected: "conversation" | "browser";
  /** The browser is doing something the person is not currently watching. */
  live?: boolean;
  onSelect: (view: "conversation" | "browser") => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const views = ["conversation", "browser"] as const;
  return (
    <div className={styles["workspace-tabs"]}>
      <div role="tablist" aria-label="Workspace view">
        {views.map((view, index) => (
          <button
            key={view}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${id}-${view}-tab`}
            aria-controls={`${id}-view`}
            aria-selected={selected === view}
            // Decorative: what the browser is doing is said in words in the
            // conversation, so the mark is not the only way to learn it.
            data-live={view === "browser" && live && selected !== view}
            tabIndex={selected === view ? 0 : -1}
            onClick={() => onSelect(view)}
            onKeyDown={(event) => {
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 1
                    : event.key === "ArrowLeft" || event.key === "ArrowRight"
                      ? 1 - index
                      : undefined;
              if (next === undefined) return;
              event.preventDefault();
              onSelect(views[next]!);
              tabs.current[next]?.focus();
            }}
          >
            {view === "conversation" ? "Conversation" : "Workspace"}
          </button>
        ))}
      </div>
    </div>
  );
}
