import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "./Icon.js";
import { usePopover } from "./usePopover.js";
import { visibleText } from "./visibleText.js";
import styles from "./shared.module.css";

/** One of the things a surface can show, offered in its menu. */
type SurfaceItem = {
  readonly id: string;
  readonly name: string;
  /** Where it is, or what kind of thing it is, under its name. */
  readonly detail?: string;
};

/** The menu of what a surface can show, offered when there is a choice. */
export type SurfaceMenuProps = {
  /** The button's name, read out: "Documents", "In 3D". */
  readonly label: string;
  /** The list's name: "This conversation's documents". */
  readonly listLabel: string;
  readonly items: readonly SurfaceItem[];
  readonly current: string;
  readonly onPick: (id: string) => void;
};

/**
 * What a surface hands whatever fills it: the surface's name, its menu of
 * other items and its close button. What fills it adds its own title and
 * tools, so every surface is framed alike.
 */
export type FrameParts = {
  readonly label: string;
  readonly menu?: SurfaceMenuProps;
  readonly close?: { readonly label: string; readonly onClose: () => void };
};

/**
 * The frame every surface beside the conversation is drawn in: the document,
 * the 3D view and the browser look and work alike, whatever fills them. Its
 * title row names what is shown and where it is, offers the surface's other
 * items, the tools of what fills it, and a way to close; a second row holds
 * the tools that need more room. What fills it is its children.
 */
export function SurfaceFrame({
  label,
  icon,
  title,
  titleHint,
  detail,
  status,
  menu,
  tools,
  close,
  bar,
  working = false,
  children,
}: {
  /** The surface's name, read out: "Document", "3D view". */
  label: string;
  icon?: IconName;
  title: string;
  /** The whole of a title cut short, shown on hover. */
  titleHint?: string | undefined;
  /** Where it is, in the data face: a folder, an address. */
  detail?: string;
  /** What it is doing, in words, in place of where it is: "Loading…". */
  status?: string | undefined;
  menu?: SurfaceMenuProps;
  /** Controls in the title row, before the close button. */
  tools?: ReactNode;
  close?: { readonly label: string; readonly onClose: () => void };
  /** A second row of controls under the title. */
  bar?: ReactNode;
  /** Something is under way: the title row says so with a quiet line. */
  working?: boolean;
  children: ReactNode;
}) {
  return (
    <aside className={styles["surface-frame"]} aria-label={label}>
      <div className={styles["surface-frame__chrome"]} data-working={working}>
        <div className={styles["surface-frame__title"]}>
          {icon && <Icon name={icon} />}
          <h2 title={titleHint}>{visibleText(title)}</h2>
          <span
            className={styles["surface-frame__detail"]}
            data-status={status !== undefined}
          >
            {status ?? (detail && visibleText(detail))}
          </span>
          {menu && menu.items.length > 1 && <SurfaceMenu {...menu} />}
          {tools}
          {close && (
            <FrameButton icon="x" label={close.label} onClick={close.onClose} />
          )}
        </div>
        {bar && <div className={styles["surface-frame__bar"]}>{bar}</div>}
      </div>
      {children}
    </aside>
  );
}

/** A small button of the frame, named by its label and shown as an icon. */
export function FrameButton({
  ref,
  icon,
  label,
  onClick,
  disabled = false,
  expanded,
  controls,
}: {
  ref?: Ref<HTMLButtonElement>;
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
  /** What it opens, while that is shown. */
  controls?: string | undefined;
}) {
  return (
    <button
      ref={ref}
      className={styles["surface-frame__icon-button"]}
      type="button"
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A few choices side by side, one of them on: a zoom, a way of looking. */
export function FrameChoice<T extends string>({
  label,
  choices,
  value,
  onChoose,
}: {
  label: string;
  choices: readonly { readonly value: T; readonly label: ReactNode }[];
  value: T | undefined;
  onChoose: (value: T) => void;
}) {
  return (
    <div
      className={styles["surface-frame__choice"]}
      role="group"
      aria-label={label}
    >
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          aria-pressed={value === choice.value}
          onClick={() => onChoose(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** Said in place of what fills the surface while it is on its way. */
export function FrameWaiting({ children }: { children: ReactNode }) {
  return (
    <div className={styles["surface-frame__waiting"]}>
      <p role="status">
        <FrameSpinner />
        {children}
      </p>
    </div>
  );
}

/**
 * The turning mark of something under way, beside the words that say what;
 * it holds still for a person who asked for less motion.
 */
export function FrameSpinner() {
  return <span className={styles["surface-frame__spinner"]} />;
}

/**
 * Says why what fills the surface is not shown, with what the person can do
 * instead. The icon sits on the first line of the text, not in its middle.
 */
export function FrameNotice({
  title,
  children,
  actions,
}: {
  /** A first line in bold, when the notice has one. */
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles["surface-frame__notice"]} role="alert">
      <Icon name="alert" />
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
        {actions && (
          <div className={styles["surface-frame__notice-actions"]}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/** The surface's other items, to show one of them instead. */
function SurfaceMenu({
  label,
  listLabel,
  items,
  current,
  onPick,
}: SurfaceMenuProps) {
  const { open, toggle, close, onKeyDown, root, trigger, panel, panelId } =
    usePopover<HTMLUListElement>();

  return (
    <div className={styles["surface-menu"]} ref={root} onKeyDown={onKeyDown}>
      <div className={styles["surface-menu__button"]}>
        <FrameButton
          ref={trigger}
          icon="chevron"
          label={label}
          expanded={open}
          controls={open ? panelId : undefined}
          onClick={() => toggle()}
        />
      </div>
      {open && (
        <ul
          ref={panel}
          id={panelId}
          className={styles["surface-menu__list"]}
          aria-label={listLabel}
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === current}
                onClick={() => {
                  close();
                  if (item.id !== current) onPick(item.id);
                }}
              >
                <span>{visibleText(item.name)}</span>
                {item.detail && <small>{visibleText(item.detail)}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
