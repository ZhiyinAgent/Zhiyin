import { useEffect, useEffectEvent, useState } from "react";
import type { ModelCatalog, UsageState } from "@zhiyin/contract";
import { Icon, LoadingSkeleton, SurfacePanel } from "../shared/index.js";
import {
  ConversationCosts,
  CostByDay,
  ModelMix,
  RequestsByDay,
  UsageMetrics,
} from "./UsageFigures.js";
import styles from "./usage.module.css";

type UsageRangeKey = "7" | "30";

/**
 * The catalogue's names for the models used, once it answers. A model it no
 * longer lists, or a catalogue that cannot be reached, leaves the id.
 */
function useModelNames(listModels?: () => Promise<ModelCatalog>) {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  /** Asked once when the page opens, however often the caller re-renders. */
  const list = useEffectEvent(() => listModels?.());
  useEffect(() => {
    let current = true;
    void list()
      ?.then((catalog) => {
        if (current && catalog.status === "ready")
          setNames(new Map(catalog.models.map((m) => [m.id, m.name])));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return names;
}

export function UsagePanel({
  onClose,
  availability,
  conversations = [],
  onOpenConversation,
  onListModels,
}: {
  onClose: () => void;
  availability: UsageState;
  /** The conversations that still exist, to name the ones that cost something. */
  conversations?: readonly { readonly id: string; readonly title: string }[];
  onOpenConversation?: (id: string) => void;
  /** The model catalogue, to name models rather than show their ids. */
  onListModels?: () => Promise<ModelCatalog>;
}) {
  const titles = new Map(conversations.map((item) => [item.id, item.title]));
  const modelNames = useModelNames(onListModels);
  const [range, setRange] = useState<UsageRangeKey>("7");
  const [chosenCurrency, setCurrency] = useState("USD");
  const usage =
    availability.status === "ready" ? availability.ranges[range] : null;

  return (
    <SurfacePanel
      className={styles["usage"]}
      label="Usage overview"
      eyebrow={<p className="instrument-label">Account / Usage</p>}
      title="Usage"
      description="Requests, model mix, and cost on this device, as providers reported it or estimated from price lists."
      controls={
        <div className={styles["range-control"]} aria-label="Usage range">
          <button
            type="button"
            aria-pressed={range === "7"}
            onClick={() => setRange("7")}
          >
            7 days
          </button>
          <button
            type="button"
            aria-pressed={range === "30"}
            onClick={() => setRange("30")}
          >
            30 days
          </button>
        </div>
      }
      closeLabel="Close usage"
      onClose={onClose}
    >
      {availability.status === "loading" && (
        <LoadingSkeleton label="Loading usage" />
      )}

      {(availability.status === "unavailable" ||
        availability.status === "failed") && (
        <div className={styles["usage-unavailable"]}>
          <Icon name="usage" />
          <strong>
            {availability.status === "failed"
              ? "Usage could not be shown"
              : "No usage data yet"}
          </strong>
          <p>{availability.reason}</p>
        </div>
      )}

      {usage && (
        <>
          <UsageMetrics usage={usage} />

          <div className={styles["usage-instruments"]}>
            <RequestsByDay usage={usage} />
            <CostByDay
              usage={usage}
              chosen={chosenCurrency}
              onChoose={setCurrency}
            />
            <ModelMix usage={usage} names={modelNames} />
            <ConversationCosts
              usage={usage}
              titles={titles}
              onOpen={onOpenConversation}
            />
          </div>
        </>
      )}
    </SurfacePanel>
  );
}
