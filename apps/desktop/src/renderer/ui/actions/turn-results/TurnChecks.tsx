import { useId } from "react";
import type { ActionDetail, TaskAction } from "@zhiyin/contract";
import { ranToItsEnd } from "@zhiyin/conversation-rules";
import { Icon } from "../../shared/index.js";
import styles from "./turn-results.module.css";

type Checks = Extract<ActionDetail, { kind: "checks" }>;

/**
 * The checks a turn's finished actions measured, the last of each list: a
 * turn that built five times is judged by its last build, and a list is
 * told apart from another by its label.
 */
export function turnChecks(actions: readonly TaskAction[]): Checks[] {
  const last = new Map<string, Checks>();
  for (const action of actions) {
    if (!ranToItsEnd(action)) continue;
    for (const detail of action.details ?? []) {
      if (detail.kind !== "checks") continue;
      last.delete(detail.label);
      last.set(detail.label, detail);
    }
  }
  return [...last.values()];
}

const verdict = (holds: boolean | null) =>
  holds === null ? "Not checked" : holds ? "Holds" : "Fails";

/**
 * One list of checks: each item's verdict in words beside its mark, then what
 * was measured. `flush` leaves out the card's edge padding, for a list in a
 * block of its own.
 */
export function CheckList({
  checks,
  flush = false,
}: {
  checks: Checks;
  flush?: boolean;
}) {
  const edge = flush ? ` ${styles["checks--flush"]}` : "";
  return (
    <>
      <ul className={`${styles["checks__rows"]}${edge}`}>
        {checks.items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className={`${styles["checks__row"]} ${
              styles[
                `checks__row--${item.holds === null ? "unchecked" : item.holds ? "holds" : "fails"}`
              ]
            }`}
          >
            <span className={styles["checks__verdict"]}>
              <Icon
                name={item.holds === null ? "info" : item.holds ? "check" : "x"}
                aria-hidden="true"
              />
              {verdict(item.holds)}
            </span>
            <span className={styles["checks__label"]}>{item.label}</span>
            {item.note && (
              <span className={styles["checks__note"]}>{item.note}</span>
            )}
          </li>
        ))}
      </ul>
      {checks.note && (
        <p className={`${styles["checks__more"]}${edge}`}>{checks.note}</p>
      )}
    </>
  );
}

/** How many of a list's checks hold, of those that could be checked. */
function tally(checks: Checks): string {
  const measured = checks.items.filter((item) => item.holds !== null);
  const holding = measured.filter((item) => item.holds);
  return `${holding.length} of ${measured.length} checked ${holding.length === 1 ? "holds" : "hold"}`;
}

/** The turn's checks, under its answer, so the verdict read there is the tool's. */
export function TurnChecks({ checks }: { checks: readonly Checks[] }) {
  return (
    <>
      {checks.map((one) => (
        <TurnCheckList key={one.label} checks={one} />
      ))}
    </>
  );
}

function TurnCheckList({ checks }: { checks: Checks }) {
  const headingId = useId();
  const failing = checks.items.some((item) => item.holds === false);
  return (
    <section className={styles["turn-files"]} aria-labelledby={headingId}>
      <header className={styles["turn-files__header"]}>
        <Icon name={failing ? "alert" : "check"} aria-hidden="true" />
        <h3 id={headingId}>
          {checks.label}: {tally(checks)}
        </h3>
      </header>
      <div className={styles["checks__body"]}>
        <CheckList checks={checks} />
      </div>
    </section>
  );
}
