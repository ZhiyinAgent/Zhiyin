import type {
  ModelCatalogEntry,
  ModelPrice,
  TokenPrices,
} from "@zhiyin/contract";
import { busyHours, perMillion, tokenCount } from "./format.js";
import styles from "./model.module.css";

/**
 * A lab's model chosen, beside the list: what it costs on the account's
 * platform, in that platform's currency, and what it can do. It stands where
 * OpenRouter's upstreams stand, so every provider's page has the same shape.
 */
export function ModelDetails({
  model,
  providerName,
}: {
  model: ModelCatalogEntry | undefined;
  providerName: string;
}) {
  return (
    <section
      className={`${styles["model-column"]} ${styles["model-column--details"]}`}
      aria-label="Model details"
    >
      <div className={styles["model-details__head"]}>
        <span className={styles["model-control__label"]}>Model</span>
        <h3>{model ? model.name : "No model selected"}</h3>
        {model && <code>{model.id}</code>}
      </div>
      {model ? (
        <>
          <Prices price={model.price} providerName={providerName} />
          <dl className={`${styles["details-card"]} ${styles["model-facts"]}`}>
            <div>
              <dt>Context window</dt>
              <dd>{tokenCount(model.contextWindow)} tokens</dd>
            </div>
            <div>
              <dt>Pictures</dt>
              <dd>{model.acceptsImages ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Reasoning</dt>
              <dd>{model.reasoning ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className={styles["model-details__note"]}>
          Choose one of {providerName}&apos;s models to see what it costs and
          what it can do.
        </p>
      )}
    </section>
  );
}

const kinds = [
  ["Input", "input"],
  ["Cached input", "cacheRead"],
  ["Cache write", "cacheWrite"],
  ["Output", "output"],
] as const;

const checkedOn = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function Prices({
  price,
  providerName,
}: {
  price: ModelPrice | undefined;
  providerName: string;
}) {
  if (!price)
    return (
      <p className={styles["model-details__note"]}>
        {providerName} lists no price for this model, so its requests are shown
        without a cost.
      </p>
    );
  const firstTier = price.tiers?.[0];
  const columns: { label: string; prices: TokenPrices }[] = [
    {
      label: price.peak
        ? "Off-peak"
        : firstTier
          ? `Up to ${tokenCount(firstTier.aboveInputTokens)} input`
          : "Price",
      prices: price,
    },
    ...(price.tiers ?? []).map((tier) => ({
      label: `Past ${tokenCount(tier.aboveInputTokens)} input`,
      prices: tier,
    })),
    ...(price.peak ? [{ label: "Busy hours", prices: price.peak }] : []),
  ];
  const rows = kinds.filter(([, kind]) =>
    columns.some((column) => column.prices[kind] !== undefined),
  );
  return (
    <div className={styles["model-details__group"]}>
      <span className={styles["model-control__label"]}>
        Price per million tokens, {price.currency}
      </span>
      <table className={`${styles["details-card"]} ${styles["price-table"]}`}>
        {columns.length > 1 && (
          <thead>
            <tr>
              <td />
              {columns.map((column) => (
                <th key={column.label} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(([label, kind]) => (
            <tr key={kind}>
              <th scope="row">{label}</th>
              {columns.map((column) => {
                const amount = column.prices[kind];
                return (
                  <td key={column.label}>
                    {amount === undefined
                      ? "—"
                      : perMillion(amount, price.currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles["model-details__note"]}>
        {price.peak && <>{busyHoursHere(price.peak)} </>}
        From {providerName}&apos;s price list, checked{" "}
        {checkedOn.format(new Date(`${price.checked}T00:00:00Z`))}. Zhiyin
        estimates each request&apos;s cost from it.
      </p>
    </div>
  );
}

/** The busy hours where the person is, naming their time zone. */
function busyHoursHere(peak: NonNullable<ModelPrice["peak"]>): string {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zone =
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(now)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  return `Busy hours, your time (${zone}): ${busyHours(peak, timeZone, now)}.`;
}
