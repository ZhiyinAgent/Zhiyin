import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { HeldUntilReady } from "../shared/index.js";
import styles from "./beside.module.css";

/**
 * The space beside the conversation and the divider between them. It holds
 * one surface at a time, such as the browser, a document or the 3D scene, and
 * knows nothing of any of them: the shell says what is shown and how to draw
 * it.
 *
 * What it showed last stays on screen, inert, while the lane closes, so a
 * closing surface slides away rather than vanishing; what it shows is a
 * value from the window's state, so that is cheap to hold.
 *
 * A new surface that has to get ready, such as a document still being drawn,
 * is drawn behind the one shown, which stays until the new one is ready, or a
 * second has passed.
 *
 * Each layout has its own width: the wide one starts at 70%, and a
 * surface may ask for its lane to be some pixels wider or narrower, as a
 * portrait document does to fit its page to the height. A width the person
 * chooses for a layout holds for the session, and the surface's requests for
 * that layout are set aside until the person resets it.
 */

/** What a surface may ask of the space it is drawn in. */
type BesideLane = {
  /** Asks for the lane to be this many pixels wider, or narrower if negative. */
  readonly resizeBy: (change: number) => void;
};

const wideShare = 70;
/** Where a layout with no width yet starts, before its surface asks. */
const askedShare = 50;
const clamp = (value: number) => Math.min(80, Math.max(35, value));
export function BesideSplit<Shown>({
  split,
  id,
  layout = "wide",
  shows,
  render,
  switcher,
  itemOf,
  waits,
  children,
}: {
  /** Whether the space beside the conversation is open. */
  split: boolean;
  id: string;
  /** Which width to use: each layout keeps its own. */
  layout?: string;
  /** What the space would show; nothing when the conversation has nothing. */
  shows: Shown | undefined;
  /** Draws what is shown, handing it what it calls once it is ready to be seen. */
  render: (shown: Shown, lane: BesideLane, ready: () => void) => ReactNode;
  /** Which surface a value shows: a change of surface is a swap. */
  itemOf?: (shown: Shown) => string;
  /** Whether a surface has to get ready before it takes another's place. */
  waits?: (shown: Shown) => boolean;
  /** The choice between surfaces, when there is one to make. */
  switcher?: ReactNode;
  children: ReactNode;
}) {
  const [last, setLast] = useState<Shown | undefined>(shows);
  if (shows !== undefined && last !== shows) setLast(shows);
  const present = shows !== undefined;
  useEffect(() => {
    if (present) return;
    const timer = setTimeout(() => setLast(undefined), 220);
    return () => clearTimeout(timer);
  }, [present]);
  /** Widths the person chose, and widths surfaces asked for, by layout. */
  const [chosen, setChosen] = useState<Readonly<Record<string, number>>>({});
  const [asked, setAsked] = useState<Readonly<Record<string, number>>>({});
  const share =
    chosen[layout] ??
    asked[layout] ??
    (layout === "wide" ? wideShare : askedShare);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const active = split && present;
  const resize = (value: number) =>
    setChosen((before) => ({ ...before, [layout]: clamp(value) }));
  const reset = () =>
    setChosen((before) =>
      Object.fromEntries(
        Object.entries(before).filter(([key]) => key !== layout),
      ),
    );
  // A surface asks in pixels; the lane and the area are measured as it asks.
  // It is given a new function when the layout, the person's choice or the
  // lane being open changes, so a surface that sizes itself asks again then.
  const lane = useMemo<BesideLane>(
    () => ({
      resizeBy: (change) => {
        if (!active || chosen[layout] !== undefined) return;
        const areaElement = globalThis.document.getElementById(`${id}-view`);
        const width = areaElement?.getBoundingClientRect().width ?? 0;
        const laneElement = areaElement?.firstElementChild;
        if (!width || !(laneElement instanceof HTMLElement)) return;
        const wanted = clamp(
          ((laneElement.offsetWidth + change) / width) * 100,
        );
        setAsked((before) =>
          Math.abs((before[layout] ?? -1) - wanted) < 0.5
            ? before
            : { ...before, [layout]: wanted },
        );
      },
    }),
    [id, layout, active, chosen],
  );
  const drawn = shows ?? last;

  return (
    <div
      ref={area}
      className={styles["beside-split"]}
      data-split={active}
      data-dragging={dragging}
      style={{ "--beside-share": `${share}%` } as CSSProperties}
      role={present ? "tabpanel" : undefined}
      id={`${id}-view`}
      aria-labelledby={
        present ? `${id}-${active ? "beside" : "conversation"}-tab` : undefined
      }
    >
      <div
        className={styles["beside-lane"]}
        aria-hidden={!active}
        inert={!active}
      >
        {drawn !== undefined && (
          <div className={styles["beside-surface"]}>
            {switcher}
            <HeldUntilReady
              value={drawn}
              itemOf={(shown: Shown) => itemOf?.(shown) ?? ""}
              waits={(shown: Shown) => waits?.(shown) ?? false}
              render={(shown, ready) => render(shown, lane, ready)}
            />
          </div>
        )}
      </div>
      <div
        className={styles["beside-divider"]}
        role="separator"
        aria-label="Resize the conversation and what is beside it"
        aria-orientation="vertical"
        aria-valuemin={35}
        aria-valuemax={80}
        aria-valuenow={Math.round(share)}
        tabIndex={active ? 0 : -1}
        aria-hidden={!active}
        inert={!active}
        title="Drag to resize, or use the arrow keys. Double-click to reset."
        onDoubleClick={reset}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!dragging) return;
          const bounds = area.current?.getBoundingClientRect();
          if (bounds?.width)
            resize(((event.clientX - bounds.left) / bounds.width) * 100);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onLostPointerCapture={() => setDragging(false)}
        onKeyDown={(event) => {
          const value =
            event.key === "Home"
              ? 35
              : event.key === "End"
                ? 80
                : event.key === "ArrowLeft"
                  ? share - 5
                  : event.key === "ArrowRight"
                    ? share + 5
                    : undefined;
          if (value === undefined) return;
          event.preventDefault();
          resize(value);
        }}
      />
      <div
        className={styles["beside-conversation"]}
        role="region"
        aria-label="Conversation"
      >
        {children}
      </div>
    </div>
  );
}
