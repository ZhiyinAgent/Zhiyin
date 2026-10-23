/**
 * What a range of usage is drawn as: its totals, then a figure for each way
 * of looking at it. Each is given the range and reads what it shows from it.
 */

import type { UsageRange } from "@zhiyin/contract";
import { formatMoney } from "../shared/index.js";
import { DailyChart } from "./DailyChart.js";
import { currencyNames, scaleMoney, SpentAmounts, spentIn } from "./spent.js";
import styles from "./usage.module.css";

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function count(value: number, one: string, many: string) {
  return `${value.toLocaleString("en")} ${value === 1 ? one : many}`;
}

/** The conversations shown by cost; the rest are in the files. */
const shownConversations = 8;

/** The range in three numbers: requests, what they cost, and their tokens. */
export function UsageMetrics({ usage }: { usage: UsageRange }) {
  const anyEstimated = spentIn(usage).some((each) => each.estimated);
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const inputShare = totalTokens
    ? Math.round((usage.inputTokens / totalTokens) * 100)
    : 0;
  return (
    <div className={styles["usage-metrics"]}>
      <article>
        <span className="instrument-label">Requests</span>
        <strong>{usage.requests.toLocaleString("en")}</strong>
        <small>{usage.days}-day local activity</small>
      </article>
      <article>
        <span className="instrument-label">Provider cost</span>
        <strong>
          <SpentAmounts spent={usage} stacked />
        </strong>
        <small>
          {usage.pricedRequests === usage.requests
            ? anyEstimated
              ? "Reported or estimated for every request"
              : "Reported for every request"
            : `${usage.pricedRequests.toLocaleString("en")} of ${count(usage.requests, "request", "requests")} priced${anyEstimated ? ", some estimated" : ""}`}
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
  );
}

/** How many requests each day of the range made. */
export function RequestsByDay({ usage }: { usage: UsageRange }) {
  return (
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
  );
}

/**
 * What each day of the range cost, in one currency at a time: costs are
 * never converted. Where the range was paid in several, the person chooses.
 */
export function CostByDay({
  usage,
  chosen,
  onChoose,
}: {
  usage: UsageRange;
  /** The currency last chosen; the first one spent in stands where it is absent. */
  chosen: string;
  onChoose: (currency: string) => void;
}) {
  const spent = spentIn(usage);
  const charted = spent.find((each) => each.currency === chosen) ?? spent[0];
  const currency = charted?.currency ?? "USD";
  return (
    <figure>
      <figcaption>
        <div>
          <span className="instrument-label">
            Cost rhythm
            {charted?.estimated
              ? currency === "USD" && usage.costUsd > 0
                ? " · partly estimated"
                : " · estimated"
              : ""}
          </span>
          <strong>Provider cost by day</strong>
        </div>
        {spent.length > 1 && (
          <div className={styles["range-control"]} aria-label="Currency">
            {spent.map((each) => (
              <button
                key={each.currency}
                type="button"
                aria-pressed={each.currency === currency}
                aria-label={currencyNames[each.currency] ?? each.currency}
                onClick={() => onChoose(each.currency)}
              >
                {each.currency}
              </button>
            ))}
          </div>
        )}
      </figcaption>
      <DailyChart
        name="Cost by day"
        shape="bars"
        points={usage.activity.map((point) => ({
          date: point.date,
          value:
            spentIn(point).find((each) => each.currency === currency)?.amount ??
            0,
        }))}
        format={(value) => formatMoney(value, currency)}
        formatScale={(value) => scaleMoney(value, currency)}
      />
    </figure>
  );
}

/** The share of the range's requests each model answered, and what it cost. */
type ModelUsage = UsageRange["models"][number];

/** The theme has four tones a dial can tell apart. */
const dialTones = 4;

/**
 * The models as the dial draws them, most used first: each in a tone of its
 * own, the rest past three together when there are more than the tones.
 */
function dialModels(
  models: readonly ModelUsage[],
): readonly (ModelUsage & { readonly others?: number })[] {
  if (models.length <= dialTones) return models;
  const rest = models.slice(dialTones - 1);
  const estimated = new Map<string, number>();
  for (const { estimatedCosts } of rest)
    for (const { currency, amount } of estimatedCosts ?? [])
      estimated.set(currency, (estimated.get(currency) ?? 0) + amount);
  const sum = (
    field:
      | "requests"
      | "pricedRequests"
      | "inputTokens"
      | "outputTokens"
      | "costUsd",
  ) => rest.reduce((total, model) => total + model[field], 0);
  return [
    ...models.slice(0, dialTones - 1),
    {
      model: "",
      others: rest.length,
      requests: sum("requests"),
      pricedRequests: sum("pricedRequests"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      costUsd: sum("costUsd"),
      ...(estimated.size > 0
        ? {
            estimatedCosts: [...estimated].map(([currency, amount]) => ({
              currency,
              amount,
            })),
          }
        : {}),
    },
  ];
}

export function ModelMix({
  usage,
  names,
}: {
  usage: UsageRange;
  /** The catalogue's names for the models, by id; an id it lacks is shown. */
  names: ReadonlyMap<string, string>;
}) {
  const shown = dialModels(usage.models);
  return (
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
            {shown.map((model, index) => {
              const share = usage.requests
                ? (model.requests / usage.requests) * 100
                : 0;
              const offset = shown
                .slice(0, index)
                .reduce(
                  (sum, item) => sum + (item.requests / usage.requests) * 100,
                  0,
                );
              return (
                <circle
                  className={styles[`model-dial__segment--${index}`]}
                  cx="80"
                  cy="80"
                  r="56"
                  pathLength="100"
                  strokeDasharray={`${share} ${100 - share}`}
                  strokeDashoffset={-offset}
                  key={model.model || "others"}
                />
              );
            })}
          </svg>
          <span>
            <strong>{usage.models.length}</strong>
            {usage.models.length === 1 ? "model" : "models"}
          </span>
        </div>
        <ul className={styles["model-legend"]} aria-label="Requests by model">
          {shown.map((model, index) => {
            const name = names.get(model.model);
            return (
              <li key={model.model || "others"}>
                <i
                  className={`${styles["model-key"]} ${styles[`model-key--${index}`]}`}
                />
                <span>
                  <strong data-tip={name ? model.model : undefined}>
                    {model.others
                      ? `${model.others} other models`
                      : (name ?? model.model)}
                  </strong>
                  <small>
                    {usage.requests
                      ? Math.round((model.requests / usage.requests) * 100)
                      : 0}
                    % of requests
                  </small>
                </span>
                <em>
                  <SpentAmounts spent={model} />
                </em>
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}

/**
 * What the costliest conversations of the range cost. One that still exists
 * is named and opens; one that was deleted, and what was spent outside any
 * conversation, are said as that.
 */
export function ConversationCosts({
  usage,
  titles,
  onOpen,
}: {
  usage: UsageRange;
  /** The titles of the conversations that still exist, by id. */
  titles: ReadonlyMap<string, string>;
  onOpen?: ((id: string) => void) | undefined;
}) {
  return (
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
        {usage.conversations.slice(0, shownConversations).map((spent) => {
          const title =
            spent.conversationId === undefined
              ? undefined
              : titles.get(spent.conversationId);
          const row = (
            <>
              <span>
                <strong
                  className={
                    title ? undefined : styles["conversation-costs__gone"]
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
              <em>
                <SpentAmounts spent={spent} />
              </em>
            </>
          );
          const conversationId = spent.conversationId;
          return (
            <li key={conversationId ?? ""}>
              {title && conversationId && onOpen ? (
                <button
                  type="button"
                  className={styles["conversation-costs__row"]}
                  aria-label={`Open ${title}`}
                  onClick={() => onOpen(conversationId)}
                >
                  {row}
                </button>
              ) : (
                <div className={styles["conversation-costs__row"]}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
