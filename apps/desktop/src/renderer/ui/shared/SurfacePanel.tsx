import type { ReactNode } from "react";
import { CloseButton } from "./CloseButton.js";
import styles from "./shared.module.css";

/**
 * A page that takes the place of the conversation: a heading with where it
 * sits and what it is for, controls and a close button beside it, and the
 * page's own content below.
 *
 * How the page scrolls and how much room its heading is given are options
 * here rather than rules a caller writes, because two stylesheets setting one
 * property on one element leave the answer to whichever loaded last.
 * `className` and `headerClassName` remain for what is particular to a page,
 * and are not for anything this frame already decides.
 */
export function SurfacePanel({
  label,
  className,
  headerClassName,
  scroll = "page",
  headerSpacing = "normal",
  eyebrow,
  title,
  description,
  controls,
  closeLabel,
  onClose,
  children,
}: {
  label: string;
  className?: string | undefined;
  headerClassName?: string | undefined;
  /** Whether the page scrolls as a whole, or holds its own scrolling. */
  scroll?: "page" | "contained";
  /** How much room the heading is given below itself. */
  headerSpacing?: "normal" | "loose";
  eyebrow: ReactNode;
  title: string;
  /** Left out by a page that puts its own one-line status under the title. */
  description?: string | undefined;
  controls?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`${styles["surface-panel"]}${scroll === "contained" ? ` ${styles["surface-panel--contained"]}` : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
    >
      <header
        className={`${styles["surface-panel__header"]}${headerSpacing === "loose" ? ` ${styles["surface-panel__header--loose"]}` : ""}${headerClassName ? ` ${headerClassName}` : ""}`}
      >
        <div>
          {eyebrow}
          <h1>{title}</h1>
          {description && (
            <p className={styles["surface-panel__description"]}>
              {description}
            </p>
          )}
        </div>
        <div className={styles["surface-panel__controls"]}>
          {controls}
          <CloseButton label={closeLabel} onClick={onClose} />
        </div>
      </header>
      {children}
    </section>
  );
}
