import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  REASONING_EFFORTS,
  type ReasoningCapabilities,
  type ReasoningSelection,
} from "@zhiyin/contract";
import { Icon } from "../shared/index.js";
import styles from "./conversation.module.css";

const effortOrder = REASONING_EFFORTS;

export function ReasoningControls({
  capabilities,
  value,
  onChange,
  disabled,
}: {
  capabilities: ReasoningCapabilities;
  value: ReasoningSelection;
  onChange: (value: ReasoningSelection) => void;
  disabled: boolean;
}) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const available = capabilities.status === "available";

  if (open && (disabled || !available)) setOpen(false);

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
    if (!open) return;
    slider.current?.focus();
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
  }, [open]);

  if (capabilities.status === "unavailable")
    return (
      <span title={capabilities.reason}>
        <button
          type="button"
          className={styles["reasoning-controls__bulb"]}
          aria-label="Reasoning settings unavailable"
          disabled
        >
          <Icon name="lightbulb" />
        </button>
      </span>
    );

  const defaults: ReasoningSelection =
    capabilities.required || capabilities.defaultEnabled
      ? {
          enabled: true,
          ...(capabilities.defaultEffort
            ? { effort: capabilities.defaultEffort }
            : {}),
        }
      : { enabled: false };
  const stops: { label: string; selection: ReasoningSelection }[] = [];
  if (!capabilities.required)
    stops.push({ label: "Off", selection: { enabled: false } });
  if (!capabilities.defaultEffort || capabilities.efforts.length === 0)
    stops.push({
      label: capabilities.efforts.length ? "Auto" : "On",
      selection: { enabled: true },
    });
  for (const effort of effortOrder.filter((effort) =>
    capabilities.efforts.includes(effort),
  ))
    stops.push({
      label:
        effort === "xhigh"
          ? "Extra high"
          : effort[0]!.toUpperCase() + effort.slice(1),
      selection: { enabled: true, effort },
    });
  const selected = Math.max(
    0,
    stops.findIndex(
      ({ selection }) =>
        selection.enabled === value.enabled &&
        (!selection.enabled ||
          (value.enabled &&
            selection.effort === (value.effort ?? capabilities.defaultEffort))),
    ),
  );
  const label = stops[selected]!.label;
  const active = capabilities.required || value.enabled;

  return (
    <div
      className={styles["reasoning-controls"]}
      ref={root}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !panel.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
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
        className={`${styles["reasoning-controls__bulb"]}${active ? ` ${styles["reasoning-controls__bulb--on"]}` : ""}`}
        aria-label="Reasoning settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Reasoning: ${label}`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <Icon name="lightbulb" />
      </button>
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            className={styles["reasoning-controls__panel"]}
            role="dialog"
            aria-label="Reasoning"
          >
            <div className={styles["reasoning-controls__heading"]}>
              <Icon name="lightbulb" />
              <span
                className={styles["reasoning-controls__level"]}
                aria-live="polite"
              >
                {label}
              </span>
              <button
                type="button"
                className={styles["reasoning-controls__reset"]}
                aria-label="Reset reasoning to model default"
                title="Reset to model default"
                onClick={() => onChange(defaults)}
              >
                <Icon name="rewind" />
              </button>
            </div>
            <p
              className={styles["reasoning-controls__caption"]}
              id={`${panelId}-help`}
            >
              {capabilities.required
                ? "Required by this model"
                : "Reasoning effort"}
            </p>
            {stops.length > 1 && (
              <div
                className={styles["reasoning-controls__range"]}
                style={
                  {
                    "--reasoning-fill": `${(selected / (stops.length - 1)) * 100}%`,
                  } as CSSProperties
                }
              >
                <div
                  className={styles["reasoning-controls__track"]}
                  aria-hidden="true"
                >
                  {stops.map((stop) => (
                    <i key={stop.label} />
                  ))}
                </div>
                <input
                  ref={slider}
                  type="range"
                  min={0}
                  max={stops.length - 1}
                  step={1}
                  value={selected}
                  aria-label="Reasoning effort"
                  aria-valuetext={label}
                  aria-describedby={`${panelId}-help`}
                  onChange={(event) => {
                    const stop = stops[Number(event.target.value)];
                    if (stop) onChange(stop.selection);
                  }}
                />
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
