import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { repaintTextForContrast } from "./diagramContrast.js";
import {
  diagramBackground,
  diagramInk,
  renderMermaid,
} from "./mermaidRuntime.js";
import styles from "./views.module.css";

export function DiagramView({ id, source }: { id: string; source: string }) {
  /** Keyed by what was drawn, so a result for older source still reads as not drawn. */
  const [drawn, setDrawn] = useState<{ key: string; svg?: string }>();
  const container = useRef<HTMLDivElement>(null);
  const key = `${id} ${source}`;
  useEffect(() => {
    let current = true;
    void renderMermaid(`mermaid-${id}`, source)
      .then((value) => {
        if (current) setDrawn({ key, svg: value });
      })
      .catch(() => {
        if (current) setDrawn({ key });
      });
    return () => {
      current = false;
    };
  }, [id, source, key]);
  /**
   * After the drawing is in the document and before it is painted, because the
   * colours to correct come from a stylesheet inside it and are only knowable
   * once it is there. Doing this a frame later would show the unreadable
   * version first.
   */
  useLayoutEffect(() => {
    const drawing = container.current?.querySelector("svg");
    if (drawing) repaintTextForContrast(drawing, diagramInk, diagramBackground);
  }, [drawn]);

  /*
   * Which of the three states this is in, said out loud on the element.
   *
   * A diagram appears in two steps - a line of text, then a drawing that
   * arrives later and is a different size - so anything looking at the app from
   * outside has to know when the second step has happened. Without a signal to
   * wait for, a screenshot lands wherever it lands, and two captures of
   * identical source disagree about the size of the result for reasons that
   * have nothing to do with the app. Set during render, so by the time anything
   * is painted the contrast pass below has already run against it.
   */
  if (drawn?.key !== key)
    return (
      <div
        className={styles["task-view__loading"]}
        role="status"
        data-diagram="drawing"
      >
        Drawing diagram…
      </div>
    );
  if (!drawn.svg)
    return (
      <div
        className={styles["task-view__failure"]}
        role="alert"
        data-diagram="failed"
      >
        This diagram could not be drawn. Its source is still available for
        review.
      </div>
    );
  return (
    <div
      ref={container}
      data-diagram="drawn"
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  );
}
