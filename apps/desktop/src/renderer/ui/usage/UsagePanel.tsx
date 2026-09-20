import { useState } from "react";
import type { UsageState } from "@zhiyin/contract";
import { Icon, LoadingSkeleton, SurfacePanel } from "../shared/index.js";
import styles from "./usage.module.css";

type UsageRangeKey = "7" | "30";

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatUsd(value: number) {
  const digits = value < 0.01 ? 6 : value < 1 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

function requestPath(values: readonly number[]) {
  const maximum = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 574 : (index / (values.length - 1)) * 574;
      const y = 150 - (value / maximum) * 122;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function shortDate(value: string, days: 7 | 30) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en", {
    ...(days === 7
      ? { weekday: "short" as const }
      : { month: "short" as const }),
    ...(days === 30 ? { day: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function UsagePanel({
  onClose,
  availability,
}: {
  onClose: () => void;
  availability: UsageState;
}) {
  const [range, setRange] = useState<UsageRangeKey>("7");
  const usage =
    availability.status === "ready" ? availability.ranges[range] : null;
  const totalTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const inputShare = totalTokens
    ? Math.round((usage!.inputTokens / totalTokens) * 100)
    : 0;
  const chartPath = usage
    ? requestPath(usage.activity.map((point) => point.requests))
    : "";
  const visibleDates = usage
    ? usage.activity.filter((_, index) =>
        usage.days === 7
          ? true
          : index === 0 ||
            index === 7 ||
            index === 14 ||
            index === 21 ||
            index === 29,
      )
    : [];
  const maximumCost = usage
    ? Math.max(...usage.activity.map((point) => point.costUsd), 0)
    : 0;
  const maximumRequests = usage
    ? Math.max(...usage.activity.map((point) => point.requests), 1)
    : 1;

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
                  : `${usage.pricedRequests} of ${usage.requests} requests priced`}
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
            <figure className={styles["request-chart"]}>
              <figcaption>
                <div>
                  <span className="instrument-label">Request activity</span>
                  <strong>Daily volume</strong>
                </div>
                <span>{usage.requests} total</span>
              </figcaption>
              <svg
                viewBox="0 0 574 170"
                role="img"
                aria-label={`Requests over the last ${range} days`}
                preserveAspectRatio="none"
              >
                <path
                  className={styles["chart-grid"]}
                  d="M0 28H574M0 84H574M0 140H574"
                />
                <path
                  className={styles["chart-area"]}
                  d={`${chartPath} L574 170 H0 Z`}
                />
                <path className={styles["chart-line"]} d={chartPath} />
              </svg>
              <div className={styles["chart-days"]} aria-hidden="true">
                {visibleDates.map((point) => (
                  <span key={point.date}>
                    {shortDate(point.date, usage.days)}
                  </span>
                ))}
              </div>
            </figure>

            <figure>
              <figcaption>
                <span className="instrument-label">Model mix</span>
                <strong>Requests by model</strong>
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
                <ul className={styles["model-legend"]}>
                  {usage.models.map((model, index) => (
                    <li key={model.model}>
                      <i
                        className={`${styles["model-key"]} ${styles[`model-key--${index % 3}`]}`}
                      />
                      <span>
                        <strong>{model.model}</strong>
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
                  ))}
                </ul>
              </div>
            </figure>

            <figure>
              <figcaption>
                <div>
                  <span className="instrument-label">Cost rhythm</span>
                  <strong>Provider cost by day</strong>
                </div>
                <span>{formatUsd(usage.costUsd)} total</span>
              </figcaption>
              <div
                className={styles["cost-bars"]}
                role="img"
                aria-label={`Daily cost over the last ${range} days`}
              >
                {usage.activity.map((point) => {
                  const ratio = maximumCost
                    ? point.costUsd / maximumCost
                    : point.requests / maximumRequests;
                  return (
                    <span
                      key={point.date}
                      style={{ height: `${Math.max(4, ratio * 100)}%` }}
                    >
                      <i />
                    </span>
                  );
                })}
              </div>
            </figure>
          </div>
        </>
      )}
    </SurfacePanel>
  );
}
