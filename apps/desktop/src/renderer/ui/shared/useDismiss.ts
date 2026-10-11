import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Closing what floats over the page — a menu, a popover, a dialog — when the
 * person presses anywhere outside it.
 *
 * Open layers form a stack, and a press outside closes only the one on top: a
 * dialog opened over another closes alone. Popovers also close when the
 * window loses focus, which is all the page is told of a click in another
 * application or in the embedded browser; a dialog stays, so something can be
 * copied into it from elsewhere.
 *
 * The window's top bar is where it is dragged from, and a press there never
 * reaches the page. While a layer is open the root carries `data-layer-open`,
 * and the stylesheet stops the bar dragging, so a click on it closes the layer
 * like a click anywhere else.
 */

export type DismissLayer = {
  readonly elements: () => readonly (HTMLElement | null)[];
  readonly dismiss: () => void;
  readonly closeOnBlur: () => boolean;
  /** The layer this one was opened from, however far apart they are drawn. */
  readonly parent: DismissLayer | undefined;
};
type Layer = DismissLayer;

const layers: Layer[] = [];

const holds = (layer: Layer, target: Node) =>
  layer.elements().some((element) => element?.contains(target));

const openedFrom = (inner: Layer, outer: Layer) => {
  for (let parent = inner.parent; parent; parent = parent.parent)
    if (parent === outer) return true;
  return false;
};

/**
 * Whether `inner` sits above `outer`: opened from it, or held inside it. A
 * dialog is drawn over the whole window, away from what opened it, so being
 * held inside is not enough to tell.
 */
const under = (outer: Layer, inner: Layer) =>
  openedFrom(inner, outer) ||
  inner.elements().some((element) => element && holds(outer, element));

const OpenLayer = createContext<Layer | undefined>(undefined);

/** Marks what is inside as opened from this layer, wherever it is drawn. */
export const InsideLayer = OpenLayer.Provider;

function pressed(event: PointerEvent) {
  const top = layers.at(-1);
  if (top && event.target instanceof Node && !holds(top, event.target))
    top.dismiss();
}

function blurred() {
  for (const layer of [...layers]) if (layer.closeOnBlur()) layer.dismiss();
}

function add(layer: Layer) {
  if (!layers.length) {
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", blurred);
    document.documentElement.setAttribute("data-layer-open", "");
  }
  // A dialog and one inside it open together register inner first.
  const above = layers.findIndex((other) => under(layer, other));
  if (above === -1) layers.push(layer);
  else layers.splice(above, 0, layer);
}

function remove(layer: Layer) {
  const index = layers.indexOf(layer);
  if (index !== -1) layers.splice(index, 1);
  if (!layers.length) {
    document.removeEventListener("pointerdown", pressed, true);
    window.removeEventListener("blur", blurred);
    document.documentElement.removeAttribute("data-layer-open");
  }
}

/**
 * Returns the layer, for a dialog to mark what it holds with `InsideLayer`:
 * a dialog opened from inside it then closes before it does.
 */
export function useDismiss(
  open: boolean,
  inside: readonly RefObject<HTMLElement | null>[],
  dismiss: () => void,
  { closeOnBlur = true }: { closeOnBlur?: boolean } = {},
): DismissLayer {
  const parent = useContext(OpenLayer);
  const latest = useRef({ inside, dismiss, closeOnBlur });
  useLayoutEffect(() => {
    latest.current = { inside, dismiss, closeOnBlur };
  });
  const [layer] = useState<Layer>(() => ({
    elements: () => latest.current.inside.map((ref) => ref.current),
    dismiss: () => latest.current.dismiss(),
    closeOnBlur: () => latest.current.closeOnBlur,
    parent,
  }));

  useLayoutEffect(() => {
    if (!open) return;
    add(layer);
    return () => remove(layer);
  }, [open, layer]);
  return layer;
}
