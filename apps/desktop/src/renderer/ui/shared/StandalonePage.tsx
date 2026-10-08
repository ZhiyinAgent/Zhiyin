import type { ReactNode } from "react";
import { Logo } from "./Logo.js";
import styles from "./shared.module.css";

/**
 * A page shown on its own before the workspace opens: the mark and a line
 * beside it, a large heading with its introduction, whatever the page asks
 * for, and a closing note with the way forward. `split` sets what the page
 * asks for beside the heading, the note and the way forward, centred in the
 * window, for a wide window; a narrow one stacks them as usual.
 */
export function StandalonePage({
  tagline,
  label,
  title,
  introduction,
  children,
  note,
  actions,
  error,
  layout = "stacked",
}: {
  tagline?: string;
  label: string;
  title: ReactNode;
  introduction: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  error?: string;
  layout?: "stacked" | "split";
}) {
  return (
    <main className={styles["standalone-page"]}>
      <div className={styles["standalone-page__brand"]}>
        <Logo size={24} />
        {tagline && <span>{tagline}</span>}
      </div>
      <div className={styles["standalone-page__scroll"]}>
        <section
          className={`${styles["standalone-page__body"]} ${styles[`standalone-page__body--${layout}`]}`}
        >
          <div className={styles["standalone-page__intro"]}>
            <span className={styles["standalone-page__label"]}>{label}</span>
            <h1>{title}</h1>
            <p>{introduction}</p>
          </div>
          {children && (
            <div className={styles["standalone-page__content"]}>{children}</div>
          )}
          {(note || actions) && (
            <div className={styles["standalone-page__footer"]}>
              {note && (
                <div className={styles["standalone-page__note"]}>{note}</div>
              )}
              {actions}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
