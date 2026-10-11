import { useEffect, useRef, useState, type CSSProperties } from "react";
import type {
  SceneIntent,
  ScenePanelState,
  ScenePreview,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./scene.module.css";

/** Degrees the overview turns for each pixel dragged. */
const turnPerPixel = { yaw: 0.4, pitch: 0.3 };
/** How often a drag or a scroll is sent on, at most. */
const sendEvery = 80;

type Shown = {
  readonly src: string;
  readonly sequence: number;
  readonly quick: boolean;
  readonly empty: boolean;
  /** The picture's own colours at its top and bottom, to fill the view beyond it. */
  readonly edges?: Edges;
};

type Edges = { readonly top: string; readonly bottom: string };

const canReadPictures = () => typeof OffscreenCanvas !== "undefined";

/**
 * Blender's background along the picture's top and bottom edges: zoomed out,
 * the view goes on in the picture's colours rather than the panel's.
 */
function edgesOf(image: HTMLImageElement): Edges | undefined {
  if (!canReadPictures()) return undefined;
  const across = 8;
  const context = new OffscreenCanvas(across, 2).getContext("2d");
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!context || width < 2 || height < 2) return undefined;
  context.drawImage(image, 0, 0, width, 2, 0, 0, across, 1);
  context.drawImage(image, 0, height - 2, width, 2, 0, 1, across, 1);
  const pixels = context.getImageData(0, 0, across, 2).data;
  const row = (y: number) => {
    const sum = [0, 0, 0];
    for (let x = 0; x < across; x++)
      for (let c = 0; c < 3; c++) sum[c]! += pixels[(y * across + x) * 4 + c]!;
    return `rgb(${sum.map((v) => Math.round(v / across)).join(" ")})`;
  };
  return { top: row(0), bottom: row(1) };
}

/**
 * The picture's edge colours carried past it: solid above and below it, and
 * across it, from its top edge to its bottom one, wherever its scale puts them.
 */
const beyond = ({ top, bottom }: Edges, scale: number) =>
  `linear-gradient(${top} ${50 - 50 * scale}%, ${bottom} ${50 + 50 * scale}%)`;

const pictureOf = (preview: ScenePreview): Shown => ({
  src: `data:image/jpeg;base64,${preview.data}`,
  sequence: preview.sequence,
  quick: preview.quick === true,
  empty: preview.empty === true,
});

/**
 * The newest picture, once it can be drawn whole. Until then the one before
 * stays on screen, so a new picture never leaves a gap or a half-drawn frame.
 */
function useSteadyPicture(preview: ScenePreview | undefined) {
  const [shown, setShown] = useState<{ current?: Shown; previous?: Shown }>(
    () => (preview ? { current: pictureOf(preview) } : {}),
  );
  const showing = shown.current?.sequence;
  useEffect(() => {
    if (!preview || preview.sequence === showing) return;
    const next = pictureOf(preview);
    let cancelled = false;
    const image = new Image();
    image.src = next.src;
    const swap = () => {
      if (cancelled) return;
      const edges = edgesOf(image);
      setShown((now) => ({
        current: edges ? { ...next, edges } : next,
        ...(now.current ? { previous: now.current } : {}),
      }));
    };
    // A picture that will not decode is not shown; the last good one stays.
    image.decode().then(swap, () => {});
    return () => {
      cancelled = true;
    };
  }, [preview, showing]);
  // The first picture is shown as it comes; its edges are read once it decodes.
  const first = shown.current;
  useEffect(() => {
    // Only where a picture can be read back is there anything to read.
    if (!first || first.edges !== undefined || !canReadPictures()) return;
    let cancelled = false;
    const image = new Image();
    image.src = first.src;
    image.decode().then(
      () => {
        const edges = cancelled ? undefined : edgesOf(image);
        if (edges)
          setShown((now) =>
            now.current?.sequence === first.sequence
              ? { ...now, current: { ...now.current, edges } }
              : now,
          );
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [first]);
  return shown;
}

export function ScenePanel({
  scene,
  agentWorking = false,
  onLook,
}: {
  scene: ScenePanelState;
  /** Whether the agent is at work in the conversation, in Blender or not. */
  agentWorking?: boolean;
  onLook: (intent: SceneIntent) => void | Promise<void>;
}) {
  const shown = useSteadyPicture(scene.preview);
  const viewport = useRef<HTMLDivElement>(null);
  const pending = useRef({ yaw: 0, pitch: 0, zoom: 1 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  // How much closer the person has zoomed since the picture on screen was
  // drawn: the picture is scaled by it at once, until Blender draws the view.
  const [zoomed, setZoomed] = useState({ sequence: 0, factor: 1 });
  const zoomShown =
    zoomed.sequence === shown.current?.sequence ? zoomed.factor : 1;
  const look = (intent: SceneIntent) => void onLook(intent);
  // The window hands a new function each time it draws the panel; the size
  // watcher keeps running across those and calls the latest.
  const latestLook = useRef(onLook);
  useEffect(() => {
    latestLook.current = onLook;
  }, [onLook]);

  // The view tells Blender the size it is drawn at, in device pixels, once
  // it has stopped changing, so pictures come in the view's own shape.
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        const ratio = window.devicePixelRatio || 1;
        const { width, height } = entry.contentRect;
        if (width < 32 || height < 32) return;
        void latestLook.current({
          kind: "size",
          width: Math.round(width * ratio),
          height: Math.round(height * ratio),
        });
      }, 250);
    });
    observer.observe(element);
    return () => {
      clearTimeout(settle);
      observer.disconnect();
    };
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Scrolling over the view zooms it and nothing else. React listens to the
  // wheel passively, which cannot keep the page behind from scrolling too.
  const onWheel = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    onWheel.current = (event) => {
      if (!turnable) return;
      event.preventDefault();
      gather({ zoom: Math.exp(-event.deltaY * 0.0015) });
    };
  });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const listener = (event: WheelEvent) => onWheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  /** Gathers turning and zooming, and sends what has built up at a steady pace. */
  function gather(change: { yaw?: number; pitch?: number; zoom?: number }) {
    const next = pending.current;
    next.yaw += change.yaw ?? 0;
    next.pitch += change.pitch ?? 0;
    next.zoom *= change.zoom ?? 1;
    if (change.zoom && shown.current) {
      const sequence = shown.current.sequence;
      setZoomed((now) => ({
        sequence,
        factor:
          (now.sequence === sequence ? now.factor : 1) * (change.zoom ?? 1),
      }));
    }
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const { yaw, pitch, zoom } = pending.current;
      pending.current = { yaw: 0, pitch: 0, zoom: 1 };
      if (scene.view === "camera") look({ kind: "view", view: "overview" });
      if (yaw || pitch) look({ kind: "turn", yaw, pitch });
      if (zoom !== 1) look({ kind: "zoom", factor: zoom });
    }, sendEvery);
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, () => void> = {
      ArrowLeft: () => gather({ yaw: 15 }),
      ArrowRight: () => gather({ yaw: -15 }),
      ArrowUp: () => gather({ pitch: 10 }),
      ArrowDown: () => gather({ pitch: -10 }),
      "+": () => gather({ zoom: 1.15 }),
      "=": () => gather({ zoom: 1.15 }),
      "-": () => gather({ zoom: 1 / 1.15 }),
      Home: () => look({ kind: "reset" }),
    };
    const act = step[event.key];
    if (!act || !turnable) return;
    event.preventDefault();
    act();
  }

  const working = scene.working || scene.status === "starting";
  const saying =
    scene.status === "starting"
      ? "Starting Blender…"
      : scene.working
        ? "Working…"
        : "";
  const fileName = scene.file?.split("/").pop();
  // A picture with something in it can be turned; until then there is
  // nothing to hold.
  const turnable = shown.current !== undefined && !shown.current.empty;
  const zoomStyle =
    zoomShown === 1 ? undefined : { transform: `scale(${zoomShown})` };
  const cameraMissing =
    scene.view === "camera" && scene.preview?.view === "overview";

  return (
    <aside className={styles["scene-panel"]} aria-label="3D view">
      <div className={styles["scene-panel__chrome"]} data-working={working}>
        <h2 title={scene.file}>{fileName ?? "3D scene"}</h2>
        <div
          className={styles["scene-panel__views"]}
          role="group"
          aria-label="Look through"
        >
          {(["camera", "overview"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={scene.view === view}
              onClick={() => look({ kind: "view", view })}
            >
              {view === "camera" ? "Camera" : "Overview"}
            </button>
          ))}
        </div>
        <button
          className={styles["scene-panel__reset"]}
          type="button"
          aria-label="Back to the first angle"
          title="Back to the first angle"
          disabled={scene.view !== "overview"}
          onClick={() => look({ kind: "reset" })}
        >
          <Icon name="rewind" />
        </button>
      </div>

      {scene.status === "failed" && (
        <div className={styles["scene-panel__notice"]} role="alert">
          <Icon name="alert" />
          <div>
            <strong>{scene.reason ?? "Blender stopped."}</strong>
            <p>
              It starts again from the saved scene when the agent next works on
              it.
            </p>
          </div>
        </div>
      )}
      {cameraMissing && (
        <p className={styles["scene-panel__note"]}>
          The scene has no camera yet, so this is the overview.
        </p>
      )}

      <div className={styles["scene-panel__stage"]}>
        <div
          ref={viewport}
          className={styles["scene-panel__viewport"]}
          data-turnable={turnable}
          data-dragging={dragging}
          style={
            turnable && shown.current?.edges
              ? ({
                  "--scene-edges": beyond(shown.current.edges, zoomShown),
                } as CSSProperties)
              : undefined
          }
          tabIndex={0}
          role="img"
          aria-label={
            shown.current
              ? "The scene as Blender draws it. Drag or use the arrow keys to turn the overview, scroll or use plus and minus to zoom, Home to go back."
              : "The scene, once Blender has drawn it"
          }
          onKeyDown={onKey}
          onPointerDown={(event) => {
            if (!turnable) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            const from = drag.current;
            if (!from) return;
            drag.current = { x: event.clientX, y: event.clientY };
            gather({
              yaw: -(event.clientX - from.x) * turnPerPixel.yaw,
              pitch: (event.clientY - from.y) * turnPerPixel.pitch,
            });
          }}
          onPointerUp={() => {
            drag.current = undefined;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = undefined;
            setDragging(false);
          }}
        >
          {/* A picture of an empty scene shows nothing, so the view shows the
              panel itself and says so. */}
          {shown.previous && !shown.previous.empty && !shown.current?.empty && (
            <img
              key={`previous-${shown.previous.sequence}`}
              className={styles["scene-panel__picture"]}
              style={zoomStyle}
              src={shown.previous.src}
              alt=""
              draggable={false}
            />
          )}
          {shown.current && !shown.current.empty && (
            <img
              key={`current-${shown.current.sequence}`}
              // A quick picture, drawn while the view moves, replaces the last
              // at once; a full one settles over it.
              className={`${styles["scene-panel__picture"]}${shown.current.quick ? "" : ` ${styles["scene-panel__picture--new"]}`}`}
              style={zoomStyle}
              src={shown.current.src}
              alt=""
              draggable={false}
            />
          )}
        </div>
        {/* Said over the view, outside it: what a picture holds is not read out. */}
        {!saying &&
          scene.status !== "failed" &&
          (!shown.current || shown.current.empty) && (
            <p className={styles["scene-panel__waiting"]}>
              {!shown.current ? (
                "The scene appears here once the agent opens one."
              ) : agentWorking ? (
                <>
                  <span className={styles["scene-panel__spinner"]} />
                  Nothing in the scene yet. The agent is still working.
                </>
              ) : (
                "The scene is empty. What the agent makes appears here."
              )}
            </p>
          )}
        <p
          className={`${styles["scene-panel__status"]}${turnable ? ` ${styles["scene-panel__status--over"]}` : ""}`}
          role="status"
        >
          {saying && (
            <span className={styles["scene-panel__saying"]}>
              <span className={styles["scene-panel__spinner"]} />
              {saying}
            </span>
          )}
        </p>
      </div>
    </aside>
  );
}
