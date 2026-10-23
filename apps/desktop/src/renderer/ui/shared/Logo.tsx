import type { CSSProperties } from "react";
import markUrl from "../../assets/logo-zhiyin.svg";
import styles from "./shared.module.css";

/**
 * The mark, with the name beside it unless compact. `size` is the mark's width
 * in pixels; the name keeps its proportion to the mark at any size.
 */
export function Logo({
  compact = false,
  size,
}: {
  compact?: boolean;
  size?: number;
}) {
  return (
    <span
      className={
        compact
          ? `${styles["zy-logo"]} ${styles["zy-logo--compact"]}`
          : styles["zy-logo"]
      }
      style={
        size === undefined
          ? undefined
          : ({ "--logo-size": `${size}px` } as CSSProperties)
      }
    >
      <img src={markUrl} alt="Zhiyin" />
      {!compact && <span className={styles["zy-logo__word"]}>ZHIYIN</span>}
    </span>
  );
}
