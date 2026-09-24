/**
 * How full the next request is against the budget the person chose, beside
 * the reasoning control and working the same way. It reads the size the loop
 * measured for the last request it sent, plus the message being written, and
 * the budget's target for the model chosen now — so it follows a model switch
 * or a budget change at once. When the size or the window is not known it says
 * so, and is never drawn as empty.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  contextBudgets,
  contextTarget,
  fixedPartFits,
  type ContextBudgetChoice,
  type ContextUsage,
  type ModelWindow,
} from "@zhiyin/contract";
import { Dialog } from "../shared/index.js";
import styles from "./conversation.module.css";

const names: Record<ContextBudgetChoice, string> = {
  low: "Low",
  medium: "Medium",
  ultra: "Ultra",
};

/** Room kept for the answer, as the loop keeps it. */
const replyReserve = 16_000;

function short(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

const whole = (tokens: number) => tokens.toLocaleString("en-US");

export function ContextRing({
  usage,
  model,
  budget,
  draftTokens,
  onChoose,
  disabled,
}: {
  /** The last request the loop sent; absent before the first. */
  usage?: ContextUsage;
  model: ModelWindow & { readonly model: string };
  budget: ContextBudgetChoice;
  draftTokens: number;
  onChoose: (budget: ContextBudgetChoice) => void;
  disabled: boolean;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState(false);

  const options = contextBudgets(model);
  const chosen = contextTarget(budget, model);
  // Budgets the window caps to one target; the menu says so, not implying
  // the larger one buys more room.
  const same = options.filter(
    (option) =>
      options.filter((other) => other.targetTokens === option.targetTokens)
        .length > 1,
  );
  const known = usage !== undefined && model.contextWindow !== undefined;
  const total = (usage?.totalTokens ?? 0) + draftTokens;
  const percent = Math.round((total / chosen.targetTokens) * 100);
  const label = known
    ? `Context: ${percent}% of the ${names[chosen.budget]} budget`
    : "Context: size not known yet";
  const fixed = usage ? usage.parts.instructions + usage.parts.tools : 0;

  if (open && disabled) setOpen(false);

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !panel.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      panel.current.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
      panel.current.style.bottom = `${window.innerHeight - anchor.top + 10}px`;
    }
    position();
    window.addEventListener("resize", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || breakdown) return;
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, breakdown]);

  const reply = Math.min(
    model.maximumOutputTokens ?? replyReserve,
    replyReserve,
  );
  const rows: [string, number][] = usage
    ? [
        ["Instructions", usage.parts.instructions],
        ["Tool definitions", usage.parts.tools],
        ["Summary", usage.parts.summary],
        ["Conversation", usage.parts.conversation],
        ["Tool results", usage.parts.toolResults],
        ["Your message", draftTokens],
      ]
    : [];

  return (
    <div
      className={styles["reasoning-controls"]}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !breakdown) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={`${styles["reasoning-controls__bulb"]} ${styles["context-ring"]}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={known ? undefined : styles["context-ring__dial--unknown"]}
          style={
            {
              "--context-fill": `${Math.min(100, known ? percent : 25)}`,
            } as CSSProperties
          }
        >
          <circle
            className={styles["context-ring__track"]}
            cx="10"
            cy="10"
            r="7"
          />
          <circle
            className={`${styles["context-ring__fill"]}${known && percent >= 100 ? ` ${styles["context-ring__fill--over"]}` : ""}`}
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
          />
        </svg>
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            className={`${styles["reasoning-controls__panel"]} ${styles["context-ring__panel"]}`}
            role="dialog"
            aria-label="Context"
          >
            <p className={styles["context-ring__status"]} aria-live="polite">
              {known
                ? `${percent}% of ${short(chosen.targetTokens)} tokens`
                : "The size is known once a message has been sent to a listed model."}
            </p>
            <div
              role="radiogroup"
              aria-label="Context budget"
              className={styles["context-ring__choices"]}
            >
              {options.map((option) => (
                <label key={option.budget}>
                  <input
                    type="radio"
                    name={`${panelId}-budget`}
                    checked={option.budget === chosen.budget}
                    onChange={() => onChoose(option.budget)}
                  />
                  <span>{names[option.budget]}</span>
                  <span>{short(option.targetTokens)}</span>
                </label>
              ))}
            </div>
            <p className={styles["reasoning-controls__caption"]}>
              A larger budget keeps more of the conversation word for word, and
              costs more on every request.
              {same.length > 1 &&
                ` ${same.map((option) => names[option.budget]).join(" and ")} give the same room on this model: its window leaves no more.`}
            </p>
            {usage && !fixedPartFits(usage, chosen.targetTokens) && (
              <p className={styles["context-ring__warning"]} role="note">
                Instructions and tools take{" "}
                {Math.round((fixed / chosen.targetTokens) * 100)}% of this
                budget. Turn off connectors this conversation does not need, or
                choose a larger budget.
              </p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!usage}
              onClick={() => setBreakdown(true)}
            >
              What's using space
            </button>
          </div>,
          document.body,
        )}
      {breakdown && usage && (
        <Dialog
          title="What's using space"
          onClose={() => {
            setBreakdown(false);
            trigger.current?.focus();
          }}
        >
          <table className={styles["context-ring__breakdown"]}>
            <tbody>
              {rows.map(([name, tokens]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{whole(tokens)}</td>
                  <td>Estimated</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Next request</th>
                <td>{whole(total)}</td>
                <td>
                  {usage.measured ? "Counted by the provider" : "Estimated"}
                </td>
              </tr>
              <tr>
                <th scope="row">Kept for the answer</th>
                <td>{whole(reply)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p>
            <strong>
              {known
                ? `${percent}% of ${short(chosen.targetTokens)}`
                : "Not known yet"}
            </strong>{" "}
            — the {names[chosen.budget]} budget.
          </p>
          <p>
            The model's own limit:{" "}
            <span>
              {model.contextWindow ? whole(model.contextWindow) : "not listed"}
            </span>{" "}
            tokens.
          </p>
        </Dialog>
      )}
    </div>
  );
}
