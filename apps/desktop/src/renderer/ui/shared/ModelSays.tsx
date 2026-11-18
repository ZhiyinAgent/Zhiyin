import type { ReactNode } from "react";
import styles from "./shared.module.css";

/**
 * The words that say the AI wrote what follows. Every place that shows what a
 * model wrote about its own work names it so, in these words.
 */
export const modelAttribution = "The AI says";

/** What the attribution means, shown when it is pointed at. */
const modelAttributionNote =
  "Written by the AI. It can be wrong, or misled by what it read.";

/**
 * Text a model wrote about an action, a command or a specialist's task, after
 * the attribution: shown, never as Zhiyin's own account of what happens.
 */
export function ModelSays({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      className={`${styles["model-says"]}${className ? ` ${className}` : ""}`}
    >
      <span
        className={styles["model-says__by"]}
        data-tip={modelAttributionNote}
      >
        {modelAttribution}
      </span>{" "}
      {children}
    </span>
  );
}
