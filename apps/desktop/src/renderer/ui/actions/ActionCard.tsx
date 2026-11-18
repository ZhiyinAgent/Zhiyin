import { useState } from "react";
import type { TaskAction } from "@zhiyin/contract";
import type { AskedReason } from "./actionFacts.js";
import { Icon } from "../shared/index.js";
import styles from "./actions.module.css";

/**
 * The parts every action shares, wherever it is shown: the card that asks,
 * the record of it in the conversation, and its account. An action is one
 * card design in four states, asking, running, done, and failed, denied or
 * blocked; these are the pieces each state draws the same way.
 */

/**
 * The action's kind, as the icon in its box: on the card that asks, `asking`;
 * on the record of what ran, `record` tints it by how the action stands.
 */
export function ActionKind({
  name,
  asking = false,
  record,
}: {
  name: Parameters<typeof Icon>[0]["name"];
  asking?: boolean;
  record?: TaskAction["status"];
}) {
  const looks = [
    styles["action-kind"],
    asking && styles["action-kind--asking"],
    record && styles["action-kind--record"],
    record && styles[`action-kind--${record}`],
  ].filter(Boolean);
  return (
    <span className={looks.join(" ")} aria-hidden="true">
      <Icon name={name} />
    </span>
  );
}

/**
 * Why the person is asked, on one line: the reasons' names, then a clause
 * that says what they mean. More opens the whole explanation in its place,
 * on a press, so it is found without pointing and works by touch.
 */
export function AskedReasons({ reason }: { reason: AskedReason }) {
  const [whole, setWhole] = useState(false);
  return (
    <div className={styles["asked-why"]}>
      <Icon name="info" />
      <p aria-label="Why you’re asked">
        <strong>{reason.labels.join(" · ")}</strong>
        {whole
          ? `. ${reason.explanation}`
          : reason.short
            ? `: ${reason.short}`
            : ""}{" "}
        <button
          type="button"
          className={styles["asked-why__more"]}
          aria-expanded={whole}
          onClick={() => setWhole((open) => !open)}
        >
          {whole ? "Less" : "More"}
        </button>
      </p>
    </div>
  );
}
