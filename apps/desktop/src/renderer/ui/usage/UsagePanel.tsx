import { useEffect, useEffectEvent, useState } from "react";
import type { ModelCatalog, UsageState } from "@zhiyin/contract";
import { Icon, LoadingSkeleton, SurfacePanel } from "../shared/index.js";
import { DailyChart } from "./DailyChart.js";
import styles from "./usage.module.css";

type UsageRangeKey = "7" | "30";

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Cents for anything worth a cent; below that, two significant places. */
function formatUsd(value: number) {
  if (value === 0 || value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${Number(value.toPrecision(2)).toString()}`;
}

/** A scale reads in whole dollars when it can. */
function scaleUsd(value: number) {
  return Number.isInteger(value) ? `$${value}` : formatUsd(value);
}

function count(value: number, one: string, many: string) {
  return `${value.toLocaleString("en")} ${value === 1 ? one : many}`;
}

/** The conversations shown by cost; the rest are in the files. */
const shownConversations = 8;

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
  const usage =
    availability.status === "ready" ? availability.ranges[range] : null;
  const totalTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const inputShare = totalTokens
    ? Math.round((usage!.inputTokens / totalTokens) * 100)
    : 0;

  return (
    <SurfacePanel
      label="Usage overview"
      eyebrow={<p className="instrument-label">Account / Usage</p>}
      title="Usage"
      description="Requests, model mix, and provider-reported cost on this device."
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

      {availability.status === "unavailable" && (
        <div className={styles["usage-unavailable"]}>
          <Icon name="usage" />
          <strong>No usage data yet</strong>
          <p>{availability.reason}</p>
        </div>
      )}

      {usage && (
        <>
          <div className={styles["usage-metrics"]}>
            <article>
              <span className="instrument-label">Requests</span>
              <strong>{usage.requests.toLocaleString("en")}</strong>
              <small>{usage.days}-day local activity</small>
            </article>
            <article>
              <span className="instrument-label">Provider cost</span>
              <strong>{formatUsd(usage.costUsd)}</strong>
              <small>
                {usage.pricedRequests === usage.requests
                  ? "Reported for every request"
                  : `${usage.pricedRequests.toLocaleString("en")} of ${count(usage.requests, "request", "requests")} priced`}
              </small>
            </article>
            <article>
              <span className="instrument-label">Tokens processed</span>
              <strong>{compactNumber.format(totalTokens)}</strong>
              <small>
                {inputShare}% input · {100 - inputShare}% output
              </small>
            </article>
          </div>

          <div className={styles["usage-instruments"]}>
            <figure>
              <figcaption>
                <div>
                  <span className="instrument-label">Request activity</span>
                  <strong>Requests by day</strong>
                </div>
              </figcaption>
              <DailyChart
                name="Requests by day"
                shape="line"
                points={usage.activity.map((point) => ({
                  date: point.date,
                  value: point.requests,
                }))}
                format={(value) => count(value, "request", "requests")}
                formatScale={(value) => value.toLocaleString("en")}
              />
            </figure>

            <figure>
              <figcaption>
                <div>
                  <span className="instrument-label">Cost rhythm</span>
                  <strong>Provider cost by day</strong>
                </div>
              </figcaption>
              <DailyChart
                name="Cost by day"
                shape="bars"
                points={usage.activity.map((point) => ({
                  date: point.date,
                  value: point.costUsd,
                }))}
                format={formatUsd}
                formatScale={scaleUsd}
              />
            </figure>

            <figure className={styles["model-mix"]}>
              <figcaption>
                <div>
                  <span className="instrument-label">Model mix</span>
                  <strong>Requests by model</strong>
                </div>
              </figcaption>
              <div className={styles["model-chart__body"]}>
                <div className={styles["model-dial"]}>
                  <svg
                    viewBox="0 0 160 160"
                    role="img"
                    aria-label="Usage share by model"
                  >
                    <circle
                      className={styles["model-dial__track"]}
                      cx="80"
                      cy="80"
                      r="56"
                    />
                    {usage.models.map((model, index) => {
                      const share = usage.requests
                        ? (model.requests / usage.requests) * 100
                        : 0;
                      const offset = usage.models
                        .slice(0, index)
                        .reduce(
                          (sum, item) =>
                            sum + (item.requests / usage.requests) * 100,
                          0,
                        );
                      return (
                        <circle
                          className={
                            styles[`model-dial__segment--${index % 3}`]
                          }
                          cx="80"
                          cy="80"
                          r="56"
                          pathLength="100"
                          strokeDasharray={`${share} ${100 - share}`}
                          strokeDashoffset={-offset}
                          key={model.model}
                        />
                      );
                    })}
                  </svg>
                  <span>
                    <strong>{usage.models.length}</strong>
                    {usage.models.length === 1 ? "model" : "models"}
                  </span>
                </div>
                <ul
                  className={styles["model-legend"]}
                  aria-label="Requests by model"
                >
                  {usage.models.map((model, index) => {
                    const name = modelNames.get(model.model);
                    return (
                      <li key={model.model}>
                        <i
                          className={`${styles["model-key"]} ${styles[`model-key--${index % 3}`]}`}
                        />
                        <span>
                          <strong data-tip={name ? model.model : undefined}>
                            {name ?? model.model}
                          </strong>
                          <small>
                            {usage.requests
                              ? Math.round(
                                  (model.requests / usage.requests) * 100,
                                )
                              : 0}
                            % of requests
                          </small>
                        </span>
                        <em>{formatUsd(model.costUsd)}</em>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </figure>

            <figure className={styles["conversation-costs"]}>
              <figcaption>
                <div>
                  <span className="instrument-label">Conversations</span>
                  <strong>Cost by conversation</strong>
                </div>
                {usage.conversations.length > shownConversations && (
                  <span>
                    The {shownConversations} costliest of{" "}
                    {usage.conversations.length.toLocaleString("en")}
                  </span>
                )}
              </figcaption>
              <ul aria-label="Cost by conversation">
                {usage.conversations
                  .slice(0, shownConversations)
                  .map((spent) => {
                    const title =
                      spent.conversationId === undefined
                        ? undefined
                        : titles.get(spent.conversationId);
                    const row = (
                      <>
                        <span>
                          <strong
                            className={
                              title
                                ? undefined
                                : styles["conversation-costs__gone"]
                            }
                          >
                            {title ??
                              (spent.conversationId === undefined
                                ? "Outside any conversation"
                                : "A deleted conversation")}
                          </strong>
                          <small>
                            {count(spent.requests, "request", "requests")}
                            {spent.pricedRequests < spent.requests
                              ? `, ${spent.pricedRequests.toLocaleString("en")} priced`
                              : ""}
                          </small>
                        </span>
                        <em>{formatUsd(spent.costUsd)}</em>
                      </>
                    );
                    return (
                      <li key={spent.conversationId ?? ""}>
                        {title && spent.conversationId && onOpenConversation ? (
                          <button
                            type="button"
                            className={styles["conversation-costs__row"]}
                            aria-label={`Open ${title}`}
                            onClick={() =>
                              onOpenConversation(spent.conversationId!)
                            }
                          >
                            {row}
                          </button>
                        ) : (
                          <div className={styles["conversation-costs__row"]}>
                            {row}
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </figure>
          </div>
        </>
      )}
    </SurfacePanel>
  );
}
