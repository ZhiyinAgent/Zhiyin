import { useEffect, useId, useRef, useState } from "react";
import type { ReasoningTrace as Trace } from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

export function ReasoningTrace({ trace }: { trace: Trace }) {
  const id = useId();
  const [expanded, setExpanded] = useState<boolean>();
  const scroll = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  const active = trace.status === "streaming";
  const open = expanded ?? active;
  useEffect(() => {
    if (open && following.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [trace.text, open]);
  if (!trace.text) return null;
  return (
    <section
      className={`${styles["reasoning-trace"]}${active ? ` ${styles["reasoning-trace--active"]}` : ""}`}
      aria-label="Model reasoning"
    >
      <button
        type="button"
        className={styles["reasoning-trace__toggle"]}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setExpanded(!open)}
      >
        <span
          className={styles["reasoning-trace__indicator"]}
          aria-hidden="true"
        />
        <span role="status">
          {active
            ? "Thinking"
            : trace.status === "interrupted"
              ? "Thinking interrupted"
              : "Thought process"}
        </span>
        <Icon name="chevron" />
      </button>
      <div id={id} hidden={!open}>
        <pre
          ref={scroll}
          className={styles["reasoning-trace__text"]}
          tabIndex={0}
          aria-label="Reasoning trace"
          onScroll={(event) => {
            const pane = event.currentTarget;
            following.current =
              pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
          }}
        >
          {trace.text}
        </pre>
      </div>
    </section>
  );
}
