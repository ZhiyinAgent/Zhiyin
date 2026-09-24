/**
 * How much of the budget the person chose the conversation already uses,
 * beside the reasoning control and working the same way. It reads the size
 * the loop measured for the last request it sent — instructions and tools
 * included — against the budget's target for the model chosen now, so it
 * follows a model switch or a budget change at once. Before the first message
 * nothing is used yet and it reads 0%; the message being written is not
 * counted until it is sent. When the model's window is not known it says so.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  contextBudgets,
  contextTarget,
  fixedPartFits,
  type ContextBudgetChoice,
  type ContextUsage,
  type ModelWindow,
} from "@zhiyin/contract";
import { Dialog, Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

const names: Record<ContextBudgetChoice, string> = {
  low: "Low",
  medium: "Medium",
  ultra: "Ultra",
};

function short(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  return `${Math.round(tokens / 1_000)}K`;
}

export function ContextRing({
  usage,
  model,
  budget,
  onChoose,
  onCondense,
  disabled,
}: {
  /** The last request the loop sent; absent before the first. */
  usage?: ContextUsage;
  model: ModelWindow & { readonly model: string };
  budget: ContextBudgetChoice;
  onChoose: (budget: ContextBudgetChoice) => void;
  /** Condenses the conversation; absent before there is one. */
  onCondense?: () => Promise<void>;
  disabled: boolean;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [breakdown, setBreakdown] = useState(false);
  const [condensing, setCondensing] = useState(false);
  const [condenseFailure, setCondenseFailure] = useState<string>();

  const options = contextBudgets(model);
  const chosen = contextTarget(budget, model);
  // Budgets the window caps to one target; the menu says so, not implying
  // the larger one buys more room.
  const same = options.filter(
    (option) =>
      options.filter((other) => other.targetTokens === option.targetTokens)
        .length > 1,
  );
  const known = model.contextWindow !== undefined;
  const total = usage?.totalTokens ?? 0;
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
    // Drawn at the end of the page, so focus is taken to it, or the keyboard
    // could not reach it.
    panel.current
      ?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
      ?.focus();
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

  const rows: readonly (readonly [string, number, string])[] = usage
    ? [
        [
          "Setup",
          fixed,
          "Zhiyin's instructions and the tools it can use. Sent with every message.",
        ],
        ...(usage.parts.summary > 0
          ? [
              [
                "Summary",
                usage.parts.summary,
                "A short version of older messages, written when the conversation was compacted.",
              ] as const,
            ]
          : []),
        [
          "Conversation",
          usage.parts.conversation + usage.parts.toolResults,
          "Your messages, Zhiyin's replies, and what it read or ran along the way.",
        ],
        [
          "Free",
          Math.max(0, chosen.targetTokens - total),
          "Room left before Zhiyin compacts older messages on its own.",
        ],
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
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle
            className={styles["context-ring__track"]}
            cx="10"
            cy="10"
            r="7"
          />
          {/* Set on the arc itself, not inherited, so Chromium repaints it on
              every change; at 0% there is no arc, not a round-capped dot. */}
          {known && total > 0 && (
            <circle
              className={`${styles["context-ring__fill"]}${percent >= 100 ? ` ${styles["context-ring__fill--over"]}` : ""}`}
              cx="10"
              cy="10"
              r="7"
              pathLength="100"
              style={{ strokeDasharray: `${Math.min(100, percent)} 100` }}
            />
          )}
          {!known && (
            <circle
              className={styles["context-ring__point"]}
              cx="10"
              cy="10"
              r="1.75"
            />
          )}
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
            <div className={styles["reasoning-controls__heading"]}>
              <button
                type="button"
                className={styles["reasoning-controls__reset"]}
                aria-label="What's using space"
                title="What's using space"
                disabled={!usage}
                onClick={() => {
                  setOpen(false);
                  setBreakdown(true);
                }}
              >
                <Icon name="usage" />
              </button>
              <span
                className={`${styles["reasoning-controls__level"]}${known && percent >= 100 ? ` ${styles["context-ring__level--over"]}` : ""}${known ? "" : ` ${styles["context-ring__level--unknown"]}`}`}
                aria-live="polite"
                title={
                  known
                    ? `${short(total)} of ${short(chosen.targetTokens)} tokens`
                    : "This model does not list its context window"
                }
              >
                {known ? `${percent}%` : "Not measured"}
              </span>
              <span />
            </div>
            <p className={styles["reasoning-controls__caption"]}>
              {same.length > 1
                ? `${same.map((option) => names[option.budget]).join(" and ")} are equal on this model`
                : "Larger costs more per request"}
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
            {usage && !fixedPartFits(usage, chosen.targetTokens) && (
              <p className={styles["context-ring__warning"]} role="note">
                Instructions and tools take{" "}
                {Math.round((fixed / chosen.targetTokens) * 100)}% of this
                budget.
              </p>
            )}
            {onCondense && (
              <button
                type="button"
                className={styles["context-ring__compact"]}
                title="Summarise older messages so the conversation takes less space"
                disabled={condensing}
                onClick={() => {
                  setCondensing(true);
                  setCondenseFailure(undefined);
                  onCondense()
                    .catch((error: unknown) =>
                      setCondenseFailure(
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                    .finally(() => setCondensing(false));
                }}
              >
                {condensing ? "Compacting…" : "Compact"}
              </button>
            )}
            {condenseFailure && (
              <p className={styles["context-ring__warning"]} role="alert">
                Couldn't compact: {condenseFailure}
              </p>
            )}
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
          <p className={styles["context-ring__breakdown-total"]}>
            {percent}% of the {names[chosen.budget]} budget (
            {short(chosen.targetTokens)})
          </p>
          <table className={styles["context-ring__breakdown"]}>
            <tbody>
              {rows.map(([name, tokens, meaning]) => (
                <BreakdownRow
                  key={name}
                  name={name}
                  tokens={tokens}
                  meaning={meaning}
                />
              ))}
            </tbody>
          </table>
        </Dialog>
      )}
    </div>
  );
}

/**
 * One part of the request. What it is, in plain words, shows as a tooltip
 * while the pointer rests on its icon or the keyboard focuses it. Drawn at the
 * end of the page above the icon, so the dialog's edges never cut it off.
 */
function BreakdownRow({
  name,
  tokens,
  meaning,
}: {
  name: string;
  tokens: number;
  meaning: string;
}) {
  const [at, setAt] = useState<{ x: number; y: number }>();
  const tipId = useId();
  const show = (target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setAt({ x: box.left + box.width / 2, y: box.top });
  };
  const hide = () => setAt(undefined);
  return (
    <tr>
      <th scope="row">
        {name}
        <button
          type="button"
          className={styles["context-ring__about"]}
          aria-label={`What is ${name}?`}
          aria-describedby={at ? tipId : undefined}
          onMouseEnter={(event) => show(event.currentTarget)}
          onMouseLeave={hide}
          onFocus={(event) => show(event.currentTarget)}
          onBlur={hide}
        >
          <Icon name="info" />
        </button>
        {at &&
          createPortal(
            <span
              id={tipId}
              role="tooltip"
              className={styles["context-ring__tip"]}
              style={{ left: at.x, top: at.y }}
            >
              {meaning}
            </span>,
            document.body,
          )}
      </th>
      <td>{tokens < 1_000 ? `${tokens}` : short(tokens)}</td>
    </tr>
  );
}
