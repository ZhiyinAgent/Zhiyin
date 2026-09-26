import { useLayoutEffect, useRef, type RefObject } from "react";

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

type Layer = {
  readonly elements: () => readonly (HTMLElement | null)[];
  readonly dismiss: () => void;
  readonly closeOnBlur: boolean;
};

const layers: Layer[] = [];

const holds = (layer: Layer, target: Node) =>
  layer.elements().some((element) => element?.contains(target));

/** Whether `outer` holds one of `inner`'s elements: `inner` sits above it. */
const under = (outer: Layer, inner: Layer) =>
  inner.elements().some((element) => element && holds(outer, element));

function pressed(event: PointerEvent) {
  const top = layers.at(-1);
  if (top && event.target instanceof Node && !holds(top, event.target))
    top.dismiss();
}

function blurred() {
  for (const layer of [...layers]) if (layer.closeOnBlur) layer.dismiss();
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

export function useDismiss(
  open: boolean,
  inside: readonly RefObject<HTMLElement | null>[],
  dismiss: () => void,
  { closeOnBlur = true }: { closeOnBlur?: boolean } = {},
): void {
  const latest = useRef({ inside, dismiss });
  useLayoutEffect(() => {
    latest.current = { inside, dismiss };
  });

  useLayoutEffect(() => {
    if (!open) return;
    const layer: Layer = {
      elements: () => latest.current.inside.map((ref) => ref.current),
      dismiss: () => latest.current.dismiss(),
      closeOnBlur,
    };
    add(layer);
    return () => remove(layer);
  }, [open, closeOnBlur]);
}
