import type { ModelProviderList, ModelProviderOption } from "@zhiyin/contract";
import { LoadingSkeleton } from "../shared/index.js";
import { perMillion, tokenCount, responseTime } from "./format.js";
import styles from "./model.module.css";

export type ProviderOrder =
  "price" | "response" | "speed" | "reliability" | "context";

const orders: readonly {
  readonly value: ProviderOrder;
  readonly label: string;
}[] = [
  { value: "price", label: "Lowest price" },
  { value: "response", label: "Fastest response" },
  { value: "speed", label: "Highest speed" },
  { value: "reliability", label: "Most reliable" },
  { value: "context", label: "Largest context window" },
];

/** Absent measurements sort last rather than best. */
function sorted(
  providers: readonly ModelProviderOption[],
  order: ProviderOrder,
): readonly ModelProviderOption[] {
  const rows = [...providers];
  const low = (value: number | null) => value ?? Number.POSITIVE_INFINITY;
  const high = (value: number | null) => value ?? Number.NEGATIVE_INFINITY;
  switch (order) {
    case "price":
      return rows.sort((a, b) => a.inputUsdPerMillion - b.inputUsdPerMillion);
    case "response":
      return rows.sort((a, b) => low(a.responseMs) - low(b.responseMs));
    case "speed":
      return rows.sort(
        (a, b) => high(b.tokensPerSecond) - high(a.tokensPerSecond),
      );
    case "reliability":
      return rows.sort((a, b) => high(b.uptimePercent) - high(a.uptimePercent));
    case "context":
      return rows.sort((a, b) => b.contextWindow - a.contextWindow);
  }
}

/** "eu" reads "EU", "global" reads "Global", a zone such as "us-east-1" as is. */
function regionName(region: string): string {
  if (region.length === 2) return region.toUpperCase();
  return region === "global" ? "Global" : region;
}

/** The provider, then the tier and region that tell its upstreams apart. */
function rowName(provider: ModelProviderOption): string {
  return [
    provider.name,
    ...(provider.tier ? [`${provider.tier} tier`] : []),
    ...(provider.region ? [regionName(provider.region)] : []),
  ].join(", ");
}

const tierTrades = {
  flex: "Flex tier: cheaper, slower, may refuse when busy",
  priority: "Priority tier: faster, costs more",
} as const;

function variantLine(provider: ModelProviderOption): string {
  return [
    ...(provider.tier ? [tierTrades[provider.tier]] : []),
    ...(provider.region ? [`Region: ${regionName(provider.region)}`] : []),
    ...(provider.quantization ? [`${provider.quantization} precision`] : []),
  ].join(" · ");
}

export function ProviderTable({
  list,
  modelName,
  loading,
  selected,
  order,
  onOrderChange,
  onToggle,
  onAutomatic,
}: {
  list: ModelProviderList | null;
  /** The catalogue's name for the model, when it is known. */
  modelName?: string;
  loading: boolean;
  selected: readonly string[];
  order: ProviderOrder;
  onOrderChange: (order: ProviderOrder) => void;
  onToggle: (slug: string) => void;
  onAutomatic: () => void;
}) {
  const automatic = selected.length === 0;
  // Flex never falls back to a standard tier, so flex alone fails when busy.
  const flexOnly =
    !automatic &&
    list?.status === "ready" &&
    selected.every(
      (slug) =>
        list.providers.find((provider) => provider.slug === slug)?.tier ===
        "flex",
    );

  return (
    <section className={styles["model-column"]} aria-label="Providers">
      <div className={styles["model-column__top"]}>
        <div className={styles["model-controls"]}>
          <div
            className={`${styles["model-control"]} ${styles["model-control--grow"]}`}
          >
            <span className={styles["model-control__label"]}>
              Providers for
            </span>
            {list?.status === "ready" ? (
              <h3 data-tip={modelName ? list.model : undefined}>
                {modelName ?? list.model}
              </h3>
            ) : (
              <h3>No model selected</h3>
            )}
          </div>
          <div className={styles["model-control"]}>
            <label
              className={styles["model-control__label"]}
              htmlFor="provider-order"
            >
              Order by
            </label>
            <select
              className={styles["model-select"]}
              id="provider-order"
              value={order}
              disabled={list?.status !== "ready"}
              onChange={(event) =>
                onOrderChange(event.target.value as ProviderOrder)
              }
            >
              {orders.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton label="Loading providers" />
      ) : !list ? (
        <div className={styles["model-empty"]}>
          <strong>Choose a model first</strong>
          <p>
            Its providers, their prices and how they have been running appear
            here.
          </p>
        </div>
      ) : list.status === "unavailable" ? (
        <div className={styles["model-empty"]} role="status">
          <strong>Providers are unavailable</strong>
          <p>{list.reason}</p>
        </div>
      ) : (
        <div>
          <button
            className={styles["model-auto-row"]}
            type="button"
            role="checkbox"
            aria-checked={automatic}
            onClick={onAutomatic}
          >
            <span className={styles["model-box"]} aria-hidden="true">
              ✓
            </span>
            <span>
              <strong>
                Any provider
                <span
                  className={`${styles["model-badge"]} ${styles["model-badge--good"]}`}
                >
                  Recommended
                </span>
              </strong>
              <p>
                Zhiyin uses whichever provider can answer, and moves to another
                when one is busy.
              </p>
            </span>
          </button>

          <div className={styles["model-provider-head"]} aria-hidden="true">
            <span />
            <span>Provider</span>
            <span>
              Input<small>$ per million</small>
            </span>
            <span className={styles["model-col--output"]}>
              Output<small>$ per million</small>
            </span>
            <span className={styles["model-col--context"]}>
              Context window<small>tokens</small>
            </span>
            <span>
              Response time<small>typical</small>
            </span>
            <span className={styles["model-col--speed"]}>
              Speed<small>tokens/second</small>
            </span>
            <span>
              Reliability<small>last 30 minutes</small>
            </span>
          </div>

          {sorted(list.providers, order).map((provider) => {
            const picked = selected.includes(provider.slug);
            return (
              <button
                key={provider.slug}
                className={styles["model-provider-row"]}
                type="button"
                role="checkbox"
                aria-checked={picked}
                disabled={!provider.acceptsTools}
                aria-label={rowName(provider)}
                onClick={() => onToggle(provider.slug)}
              >
                <span className={styles["model-box"]} aria-hidden="true">
                  ✓
                </span>
                <span className={styles["model-provider-row__name"]}>
                  <strong>{provider.name}</strong>
                  {variantLine(provider) && (
                    <span>{variantLine(provider)}</span>
                  )}
                  {provider.acceptsTools ? null : (
                    <span className={styles["model-provider-row__why"]}>
                      Can't use tools
                    </span>
                  )}
                </span>
                <span className={styles["model-cell"]}>
                  {perMillion(provider.inputUsdPerMillion)}
                </span>
                <span
                  className={`${styles["model-cell"]} ${styles["model-col--output"]}`}
                >
                  {perMillion(provider.outputUsdPerMillion)}
                </span>
                <span
                  className={`${styles["model-cell"]} ${styles["model-col--context"]}`}
                >
                  {tokenCount(provider.contextWindow)}
                </span>
                <span
                  className={`${styles["model-cell"]}${provider.responseMs === null ? ` ${styles["model-cell--absent"]}` : ""}`}
                >
                  {responseTime(provider.responseMs)}
                </span>
                <span
                  className={`${styles["model-cell"]} ${styles["model-col--speed"]}${provider.tokensPerSecond === null ? ` ${styles["model-cell--absent"]}` : ""}`}
                >
                  {provider.tokensPerSecond ?? "—"}
                </span>
                <span
                  className={`${styles["model-cell"]}${provider.uptimePercent === null ? ` ${styles["model-cell--absent"]}` : ""}`}
                >
                  {provider.uptimePercent === null
                    ? "—"
                    : `${provider.uptimePercent}%`}
                </span>
              </button>
            );
          })}
          {flexOnly && (
            <p className={styles["model-note"]} role="note">
              Only flex is chosen: when it is busy, requests fail instead of
              moving on. Choose a standard provider too.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
