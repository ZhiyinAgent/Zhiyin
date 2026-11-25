import { focusMenu, Icon, Menu, usePopover } from "../shared/index.js";
import styles from "./composer.module.css";

type WorkspaceFolder = { readonly path: string; readonly name: string };

type FolderPickerProps = {
  current?: WorkspaceFolder | undefined;
  recent?: readonly WorkspaceFolder[];
  disabled?: boolean;
  onChoose?: (() => void | Promise<void>) | undefined;
  onUseRecent?: ((path: string) => void | Promise<void>) | undefined;
};

/**
 * Which folder the work happens in, where the work is started from.
 *
 * It sits in the composer rather than in a bar of its own because it is part
 * of asking for something, not a property of the window: the folder is the
 * scope of every action the next message will authorise. Folders already
 * worked in are offered directly, so returning to one is a choice from a list
 * rather than a trip through a file dialog.
 *
 * The composer dock scrolls, so the menu is placed in the window rather than
 * inside it: above the button, or below where only that has room.
 */
export function FolderPicker({
  current,
  recent = [],
  disabled = false,
  onChoose,
  onUseRecent,
}: FolderPickerProps) {
  const {
    dismiss,
    root,
    onKeyDown,
    trigger,
    open,
    panelId,
    toggle,
    panel,
    close,
  } = usePopover({
    placement: { side: "above", gap: 7, edge: 12 },
    onOpened: focusMenu,
  });
  const others = recent.filter((folder) => folder.path !== current?.path);
  // A name shared by two listed folders gets the folder it is in beside it.
  const listed = [...(current ? [current] : []), ...others];
  const where = (folder: WorkspaceFolder) =>
    listed.filter((other) => other.name === folder.name).length > 1 && (
      <small>{parentOf(folder.path)}</small>
    );

  async function run(action: () => void | Promise<void>) {
    // The item chosen goes with the menu; focus goes back to what opened it,
    // which is also where the folder dialog returns it.
    dismiss();
    await action();
  }

  return (
    <div className={styles["folder-picker"]} ref={root} onKeyDown={onKeyDown}>
      <button
        className={styles["folder-picker__trigger"]}
        type="button"
        ref={trigger}
        disabled={disabled}
        // Named rather than left to read as a bare folder name, which says
        // nothing about what the control does.
        aria-label={`Folder: ${current?.name ?? "none chosen"}`}
        data-tip={current?.path ?? "No folder chosen yet"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => toggle()}
      >
        <Icon name="folder" />
        <span>{current?.name ?? "Choose a folder"}</span>
        <Icon name="chevron" />
      </button>
      {open && (
        <Menu
          ref={panel}
          id={panelId}
          className={styles["folder-picker__menu"]}
        >
          {current && (
            <button
              className={`${styles["folder-picker__item"]} ${styles["folder-picker__item--current"]}`}
              type="button"
              role="menuitem"
              aria-current="true"
              data-tip={current.path}
              onClick={close}
            >
              <Icon name="check" />
              <span>{current.name}</span>
              {where(current)}
            </button>
          )}
          {others.map((folder) => (
            <button
              className={styles["folder-picker__item"]}
              type="button"
              role="menuitem"
              key={folder.path}
              data-tip={folder.path}
              onClick={() =>
                void run(() => onUseRecent?.(folder.path) ?? undefined)
              }
            >
              <span>{folder.name}</span>
              {where(folder)}
            </button>
          ))}
          {onChoose && (
            <button
              className={`${styles["folder-picker__item"]} ${styles["folder-picker__item--choose"]}`}
              type="button"
              role="menuitem"
              onClick={() => void run(() => onChoose() ?? undefined)}
            >
              <Icon name="folder" />
              <span>
                {current ? "Choose another folder…" : "Choose a folder…"}
              </span>
            </button>
          )}
        </Menu>
      )}
    </div>
  );
}

/** The folder a path is in, as the person would read it. */
function parentOf(path: string): string {
  // Read once from the end: a pattern for the trailing separators would try
  // again from each one.
  let end = path.length;
  while (end > 0 && (path[end - 1] === "\\" || path[end - 1] === "/")) end -= 1;
  const trimmed = path.slice(0, end);
  const last = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return (last < 0 ? "" : trimmed.slice(0, last)) || path;
}
