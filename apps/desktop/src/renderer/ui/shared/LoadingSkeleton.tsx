import styles from "./shared.module.css";

/**
 * One placeholder shape.
 *
 * What a placeholder looks like — and that it shows a shape rather than
 * pretending to be progress — belongs here. How big it is, and where it sits,
 * belongs to whoever is drawing the thing that has not arrived yet.
 */
export function SkeletonBlock({
  variant,
  wide = false,
  className,
}: {
  variant?: "avatar" | "title" | "line" | "control";
  /** A line that fills most of its column rather than part of it. */
  wide?: boolean;
  className?: string | undefined;
}) {
  return (
    <span
      className={[
        styles["skeleton-block"],
        ...(variant ? [styles[`skeleton-block--${variant}`]] : []),
        ...(wide ? [styles["skeleton-block--wide"]] : []),
        ...(className ? [className] : []),
      ].join(" ")}
    />
  );
}

/** A list taking shape: rows of something, before the something arrives. */
export function LoadingSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {[0, 1, 2].map((row) => (
        <div className={styles["skeleton-list__row"]} key={row}>
          <SkeletonBlock variant="avatar" />
          <span>
            <SkeletonBlock variant="title" />
            <SkeletonBlock variant="line" />
          </span>
          <SkeletonBlock variant="control" />
        </div>
      ))}
    </div>
  );
}
