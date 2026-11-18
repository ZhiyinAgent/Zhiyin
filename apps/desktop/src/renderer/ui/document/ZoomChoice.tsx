import { FrameChoice } from "../shared/index.js";
import type { Zoom } from "./pageDrawings.js";
import styles from "./document.module.css";

/**
 * Fitted, or at the file's own size; a size reached with Ctrl and the wheel
 * shows as its own percentage. Where the panel is narrowest the fitted choice
 * is called Fit, still named in full for assistive technology.
 */
export function ZoomChoice({
  zoom,
  onZoom,
  fit,
}: {
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  /** What fitting is called for this kind of file: "Fit width", "Fit". */
  fit: string;
}) {
  const between = zoom !== "fit" && zoom !== 1;
  return (
    <FrameChoice
      label="Zoom"
      value={zoom === "fit" ? "fit" : between ? "between" : "actual"}
      onChoose={(choice) => {
        if (choice === "fit") onZoom("fit");
        if (choice === "actual") onZoom(1);
      }}
      choices={[
        {
          value: "fit",
          label: (
            <>
              <span className={styles["document-panel__long"]}>{fit}</span>
              <span className={styles["document-panel__short"]} aria-hidden>
                Fit
              </span>
            </>
          ),
        },
        { value: "actual", label: "100%" },
        ...(between
          ? [{ value: "between", label: `${Math.round(zoom * 100)}%` }]
          : []),
      ]}
    />
  );
}
