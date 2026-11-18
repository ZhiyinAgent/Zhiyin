import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** How far a key turns the view, in degrees, and how far a key zooms it. */
const keyTurn = { yaw: 15, pitch: 10 };
const keyZoom = 1.15;

/**
 * Turning and zooming a 3D view by dragging, the arrow keys, plus, minus and
 * Home, the same in every 3D view. Spread `handlers` on the element that is
 * turned. `turn` is given degrees to add, `zoom` a factor and `reset` goes
 * back to the first angle; `keys` and `drag` say whether each may be used
 * now. `dragging` is true while a drag is under way.
 */
export function useTurnAndZoom({
  perPixel,
  keys,
  drag,
  turn,
  zoom,
  reset,
}: {
  /** Degrees turned for each pixel dragged. */
  perPixel: { readonly yaw: number; readonly pitch: number };
  keys: boolean;
  drag: boolean;
  turn: (yaw: number, pitch: number) => void;
  zoom: (factor: number) => void;
  reset: () => void;
}) {
  const from = useRef<{ x: number; y: number } | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const stop = () => {
    from.current = undefined;
    setDragging(false);
  };
  const handlers = {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const step: Record<string, () => void> = {
        ArrowLeft: () => turn(keyTurn.yaw, 0),
        ArrowRight: () => turn(-keyTurn.yaw, 0),
        ArrowUp: () => turn(0, keyTurn.pitch),
        ArrowDown: () => turn(0, -keyTurn.pitch),
        "+": () => zoom(keyZoom),
        "=": () => zoom(keyZoom),
        "-": () => zoom(1 / keyZoom),
        Home: reset,
      };
      const act = step[event.key];
      if (!act || !keys) return;
      event.preventDefault();
      act();
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!drag) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      from.current = { x: event.clientX, y: event.clientY };
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const last = from.current;
      if (!last) return;
      from.current = { x: event.clientX, y: event.clientY };
      turn(
        -(event.clientX - last.x) * perPixel.yaw,
        (event.clientY - last.y) * perPixel.pitch,
      );
    },
    onPointerUp: stop,
    onPointerCancel: stop,
  };
  return { dragging, handlers };
}
