import { moveAmongTabs } from "../shared/index.js";
import styles from "./session-header.module.css";

/**
 * The choice, in a narrow window, between the conversation and what is open
 * beside it, each tab named by what it shows.
 */
export function BesideTabs({
  id,
  selected,
  besideName,
  live = false,
  onSelect,
}: {
  id: string;
  selected: "conversation" | "beside";
  /** What is open beside the conversation: "Browser", "Document", "3D view". */
  besideName: string;
  /** The browser is doing something the person is not currently watching. */
  live?: boolean;
  onSelect: (view: "conversation" | "beside") => void;
}) {
  const views = ["conversation", "beside"] as const;
  return (
    <div className={styles["beside-tabs"]}>
      <div role="tablist" aria-label="View" onKeyDown={moveAmongTabs}>
        {views.map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            id={`${id}-${view}-tab`}
            aria-controls={`${id}-view`}
            aria-selected={selected === view}
            // Decorative: what the browser is doing is said in words in the
            // conversation, so the mark is not the only way to learn it.
            data-live={view === "beside" && live && selected !== view}
            tabIndex={selected === view ? 0 : -1}
            onClick={() => onSelect(view)}
          >
            {view === "conversation" ? "Conversation" : besideName}
          </button>
        ))}
      </div>
    </div>
  );
}
