import { useId, useRef, useState } from "react";
import type { PlanStatus, TaskPlanItem } from "@zhiyin/contract";
import { Icon, useDismiss } from "../shared/index.js";
import styles from "./conversation.module.css";

/** What a person sees of an item: where the assistant says it stands. ADR 0063. */
type Mark = "todo" | "doing" | "done" | "skipped";

const markOf: Record<PlanStatus, Mark> = {
  pending: "todo",
  in_progress: "doing",
  done: "done",
  skipped: "skipped",
};

const markWords: Record<Mark, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
  skipped: "Skipped",
};

const settled = (mark: Mark) => mark === "done" || mark === "skipped";

export function PlanPill({ items }: { items: readonly TaskPlanItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  useDismiss(open, [root], () => setOpen(false));

  if (items.length === 0) return null;

  const marks = items.map((item) => markOf[item.status]);
  const finished = marks.filter(settled).length;
  const current =
    marks.indexOf("doing") >= 0
      ? marks.indexOf("doing")
      : marks.indexOf("todo");
  const label = current >= 0 ? items[current]!.title : "Plan complete";
  const share = Math.round((finished / items.length) * 100);
  const working = marks.includes("doing");

  return (
    <div
      className={styles["plan-pill"]}
      ref={root}
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
        className={`${styles["plan-pill__button"]}${working ? ` ${styles["plan-pill__button--working"]}` : ""}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(!open)}
      >
        <svg
          className={styles["plan-pill__ring"]}
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.5" pathLength={100} />
          {finished > 0 && (
            <circle
              className={styles["plan-pill__arc"]}
              cx="8"
              cy="8"
              r="6.5"
              pathLength={100}
              strokeDasharray={`${share} 100`}
            />
          )}
        </svg>
        <span className={styles["plan-pill__name"]}>Plan</span>{" "}
        <span className={styles["plan-pill__count"]}>
          {finished}/{items.length}
        </span>{" "}
        <span className={styles["plan-pill__current"]}>{label}</span>
        <Icon name="chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className={styles["plan-pill__panel"]} id={listId}>
          <div className={styles["plan-pill__head"]} aria-hidden="true">
            <span>Plan</span>
            <span>
              {finished} of {items.length} done
            </span>
          </div>
          <div className={styles["plan-pill__bar"]} aria-hidden="true">
            <span style={{ width: `${share}%` }} />
          </div>
          <ul className={styles["plan-pill__list"]}>
            {items.map((item, index) => {
              const mark = marks[index]!;
              return (
                <li
                  key={item.id}
                  className={`${styles["plan-pill__item"]} ${styles[`plan-pill__item--${mark}`]}`}
                >
                  <span
                    className={styles["plan-pill__marker"]}
                    aria-hidden="true"
                  >
                    {mark === "done" && <Icon name="check" />}
                  </span>
                  <span className={styles["plan-pill__text"]}>
                    <span className={styles["plan-pill__title"]}>
                      {item.title}
                    </span>
                    <span className={styles["plan-pill__state"]}>
                      {markWords[mark]}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
