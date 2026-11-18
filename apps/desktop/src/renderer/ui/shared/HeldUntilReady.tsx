import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./shared.module.css";

/** The longest a new item stays hidden behind the one before it. */
const longestHoldMs = 1000;

/** One of the two places an item is drawn in, so neither is drawn anew on a swap. */
type Slot = 0 | 1;

/**
 * Shows one item at a time. A new item that has to get ready, such as a
 * picture still being drawn, is drawn hidden behind the one before, which
 * stays on screen until the new one says it is ready, or a second has passed;
 * so a swap goes straight from one finished item to the next, with no empty
 * or half-drawn state between. The first item, with nothing before it, and
 * one with nothing to wait for show at once.
 *
 * What it holds is the value an item is drawn from, a value from the
 * window's state, so the item held is drawn as it last was.
 */
export function HeldUntilReady<Value>({
  value,
  itemOf,
  waits,
  onReady,
  render,
}: {
  value: Value;
  /** Which item a value is: a change of item is a swap. */
  itemOf: (value: Value) => string;
  /** Whether an item has to get ready before it is shown in another's place. */
  waits: (value: Value) => boolean;
  /** What is shown is ready. */
  onReady?: (() => void) | undefined;
  /** Draws an item, handing it what it calls once it is ready. */
  render: (value: Value, ready: () => void) => ReactNode;
}) {
  const [shown, setShown] = useState<{ slot: Slot; value: Value }>({
    slot: 0,
    value,
  });
  const [held, setHeld] = useState<{ slot: Slot; value: Value }>();
  /** The item that last said it is ready. */
  const [readied, setReadied] = useState<string>();
  const item = itemOf(value);
  const waiting = waits(value);

  if (value !== shown.value) {
    if (item === itemOf(shown.value) || held)
      setShown({ slot: shown.slot, value });
    else {
      setReadied(undefined);
      if (waiting) {
        setHeld(shown);
        setShown({ slot: shown.slot === 0 ? 1 : 0, value });
      } else setShown({ slot: shown.slot, value });
    }
  }
  if (held && (!waiting || readied === item)) setHeld(undefined);

  const ready = useMemo(() => () => setReadied(item), [item]);

  const told = useRef(onReady);
  useLayoutEffect(() => {
    told.current = onReady;
  });
  const isReady = !waiting || readied === item;
  useEffect(() => {
    if (isReady) told.current?.();
  }, [isReady, item]);

  const holding = held !== undefined;
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setHeld(undefined), longestHoldMs);
    return () => clearTimeout(timer);
  }, [holding, item]);

  const layers = [
    { slot: shown.slot, node: render(shown.value, ready), hidden: holding },
    ...(held
      ? [{ slot: held.slot, node: render(held.value, () => {}), hidden: false }]
      : []),
  ].sort((a, b) => a.slot - b.slot);
  return (
    <div className={styles.held} aria-busy={holding}>
      {layers.map((layer) => (
        <div
          key={layer.slot}
          className={styles["held__layer"]}
          {...(layer.hidden
            ? {
                style: { visibility: "hidden" },
                "aria-hidden": true,
                inert: true,
              }
            : {})}
        >
          {layer.node}
        </div>
      ))}
    </div>
  );
}
