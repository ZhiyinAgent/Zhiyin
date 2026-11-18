import type { CSSProperties } from "react";
import markUrl from "../../assets/logo-zhiyin.svg";
import styles from "./shared.module.css";

const markClass = {
  small: styles["zy-logo--small"],
  large: styles["zy-logo--large"],
};

/**
 * The mark, with the name beside it unless compact. `size` is the mark's width
 * in pixels; the name keeps its proportion to the mark at any size. The look
 * draws the mark, and `mark` says which of its marks: the one drawn small in
 * a line, or the large one on the new-task page.
 */
export function Logo({
  compact = false,
  size,
  mark,
}: {
  compact?: boolean;
  size?: number;
  mark?: keyof typeof markClass;
}) {
  const classes = [
    styles["zy-logo"],
    ...(compact ? [styles["zy-logo--compact"]] : []),
    ...(mark ? [markClass[mark]] : []),
  ];
  return (
    <span
      className={classes.join(" ")}
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
