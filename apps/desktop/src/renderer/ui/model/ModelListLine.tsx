import { useId } from "react";
import type { ModelListState } from "@zhiyin/contract";
import { Toggle } from "../shared/index.js";
import styles from "./model.module.css";

const publishedOn = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Where the labs' models and prices come from (ADR 0031): Zhiyin's model list
 * in force, shipped with this version or read from GitHub since, a look for a
 * newer one while it runs, and the switch that lets newer ones be read. Said
 * once, quietly, under the choice it informs.
 */
export function ModelListLine({
  state,
  checking,
  onUpdates,
}: {
  /** Unknown until the core answers. */
  state: ModelListState | null;
  checking: boolean;
  onUpdates: (enabled: boolean) => void;
}) {
  const label = useId();
  const described = useId();
  if (!state) return null;
  const published = publishedOn.format(
    new Date(`${state.published}T00:00:00Z`),
  );
  const failed =
    !checking && state.updates && state.lastCheck?.outcome === "failed"
      ? state.lastCheck.reason
      : undefined;
  return (
    <footer className={styles["model-list-line"]}>
      <p id={described}>
        Models and prices come from Zhiyin&apos;s list of {published},{" "}
        {state.source === "shipped"
          ? "shipped with this version."
          : "updated from GitHub."}
        {checking && <span role="status"> Checking for a newer list…</span>}
        {failed && (
          <span role="status"> No newer list could be used: {failed}</span>
        )}
      </p>
      <span className={styles["model-list-line__switch"]}>
        <span id={label}>Keep models and prices up to date</span>
        <Toggle
          on={state.updates}
          aria-labelledby={label}
          aria-describedby={described}
          onChange={onUpdates}
        />
      </span>
    </footer>
  );
}
