import { useCallback, useEffect, useRef, useState } from "react";
import type { PartModel, PartsPanelState } from "@zhiyin/contract";
import {
  FrameButton,
  FrameNotice,
  FrameSpinner,
  SurfaceFrame,
  useTurnAndZoom,
  visibleText,
  type FrameParts,
} from "../shared/index.js";
import { startingOrbit, turned, zoomed, type Orbit } from "./orbit.js";
import { createPartView, type PartView } from "./partView.js";
import styles from "./parts.module.css";

/** Degrees the parts turn for each pixel dragged. */
const turnPerPixel = { yaw: 0.45, pitch: 0.35 };

type Drawing =
  | { readonly status: "drawing" }
  | { readonly status: "shown" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "unsupported" };

const millimetres = (value: number) => `${Math.round(value * 100) / 100}`;

/**
 * The parts a conversation's CAD studio built last, drawn in 3D beside it:
 * turned by dragging or the arrow keys, zoomed by scrolling or plus and minus,
 * and listed with their sizes. The view keeps its angle from one build to the
 * next, so a change is seen from where the person was looking.
 */
export function PartPanel({
  parts,
  loadModel,
  createView = createPartView,
  frame = { label: "3D view" },
}: {
  parts: PartsPanelState;
  /** The 3D view's frame: its name and its menu of what else it can show. */
  frame?: FrameParts;
  /** The mesh of a build, while it is the one shown. */
  loadModel: (sequence: number) => Promise<PartModel | undefined>;
  /** How the parts are drawn; WebGL unless a test says otherwise. */
  createView?: (canvas: HTMLCanvasElement) => PartView;
}) {
  const view = useRef<PartView | undefined>(undefined);
  const orbit = useRef<Orbit>(startingOrbit);
  const [unsupported, setUnsupported] = useState(false);
  /** The build last drawn, or why it could not be. */
  const [drawn, setDrawn] = useState<{ sequence: number; failed?: string }>();
  // Read when the build changes, never a reason to fetch again by itself.
  const latestLoad = useRef(loadModel);
  useEffect(() => {
    latestLoad.current = loadModel;
  });

  // The drawing is made once, with its canvas, and goes with it.
  const makeView = useRef(createView);
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    let made: PartView;
    try {
      made = makeView.current(canvas);
    } catch {
      setUnsupported(true);
      return;
    }
    view.current = made;
    const area = canvas.parentElement;
    const observer =
      area && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const box = area.getBoundingClientRect();
            made.resize(box.width, box.height, window.devicePixelRatio || 1);
          })
        : undefined;
    if (area) observer?.observe(area);
    return () => {
      observer?.disconnect();
      made.dispose();
      view.current = undefined;
    };
  }, []);

  useEffect(() => {
    const made = view.current;
    if (!made) return;
    const sequence = parts.sequence;
    let current = true;
    void (async () => {
      try {
        const model = await latestLoad.current(sequence);
        // A build replaced while its mesh came: the newer one is on its way.
        if (!current || !model) return;
        const parsed = await made.parse(model.data);
        // Replaced while it was read: never drawn over the newer one.
        if (!current) {
          parsed.discard();
          return;
        }
        parsed.show();
        made.look(orbit.current);
        setDrawn({ sequence });
      } catch (error) {
        if (current)
          setDrawn({
            sequence,
            failed: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    return () => {
      current = false;
    };
  }, [parts.sequence]);

  const drawing: Drawing = unsupported
    ? { status: "unsupported" }
    : drawn?.sequence !== parts.sequence
      ? { status: "drawing" }
      : drawn.failed !== undefined
        ? { status: "failed", reason: drawn.failed }
        : { status: "shown" };

  const look = (next: Orbit) => {
    orbit.current = next;
    view.current?.look(next);
  };

  const { dragging, handlers } = useTurnAndZoom({
    perPixel: turnPerPixel,
    keys: drawing.status !== "unsupported",
    drag: drawing.status === "shown",
    turn: (yaw, pitch) => look(turned(orbit.current, yaw, pitch)),
    zoom: (factor) => look(zoomed(orbit.current, factor)),
    reset: () => look(startingOrbit),
  });

  // Nothing is drawn, so the drawing gives its room to the sizes.
  const nothingDrawn =
    drawing.status === "unsupported" || drawing.status === "failed";
  const title = parts.script?.split("/").pop() ?? "Parts";
  return (
    <SurfaceFrame
      {...frame}
      icon="cube"
      title={title}
      titleHint={parts.script}
      tools={
        <FrameButton
          icon="rewind"
          label="Back to the first angle"
          disabled={nothingDrawn}
          onClick={() => look(startingOrbit)}
        />
      }
    >
      {nothingDrawn && (
        <FrameNotice>
          {drawing.status === "unsupported"
            ? "This computer cannot draw the parts in 3D here. Their sizes are below, and the files the build wrote open in other programs."
            : "The mesh the build wrote could not be drawn. Building the parts again makes a new one."}
        </FrameNotice>
      )}

      <div className={styles["part-panel"]} data-nothing-drawn={nothingDrawn}>
        <div className={styles["part-panel__area"]}>
          <div
            className={styles["part-panel__stage"]}
            hidden={nothingDrawn}
            data-dragging={dragging}
            tabIndex={0}
            role="img"
            aria-label={
              drawing.status === "shown"
                ? "The parts in 3D. Drag or use the arrow keys to turn them, scroll or use plus and minus to zoom, Home to go back."
                : "The parts in 3D, once they are drawn"
            }
            {...handlers}
            onWheel={(event) => {
              if (drawing.status !== "shown") return;
              look(zoomed(orbit.current, event.deltaY < 0 ? 1.1 : 1 / 1.1));
            }}
          >
            <canvas ref={attach} className={styles["part-panel__canvas"]} />
          </div>
          {/* Said over the drawing, outside it: what a picture holds is
              not read out. Always there, so a change to it is heard. */}
          <p className={styles["part-panel__status"]} role="status">
            {drawing.status === "drawing" && (
              <>
                <FrameSpinner />
                Drawing the parts…
              </>
            )}
          </p>
        </div>

        <ul className={styles["part-panel__list"]} aria-label="Parts built">
          {parts.parts.map((part, index) => (
            <li key={`${index}-${part.name}`}>
              <span className={styles["part-panel__name"]}>
                {visibleText(part.name)}
              </span>
              <span className={styles["part-panel__size"]}>
                {part.size.map(millimetres).join(" × ")} mm
                {!part.valid && (
                  <span className={styles["part-panel__invalid"]}>
                    {" "}
                    · not a valid solid
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SurfaceFrame>
  );
}
