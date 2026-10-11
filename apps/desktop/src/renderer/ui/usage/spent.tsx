/**
 * Costs as the usage page shows them: what providers reported, in dollars,
 * and what price lists estimate where they reported nothing, each added up in
 * its own currency. A cost is never converted into another currency.
 */

import type { MoneyAmount } from "@zhiyin/contract";
import { currencySymbol, formatMoney } from "../shared/index.js";
import styles from "./usage.module.css";

/** Names for the currency switch, read aloud as well as shown. */
export const currencyNames: Readonly<Record<string, string>> = {
  USD: "US dollars",
  CNY: "Yuan",
};

/** A scale reads in whole units when it can. */
export function scaleMoney(value: number, currency = "USD"): string {
  return Number.isInteger(value)
    ? `${currencySymbol(currency)}${value}`
    : formatMoney(value, currency);
}

export type SpentIn = {
  readonly currency: string;
  readonly amount: number;
  /** Some of it was estimated from a price list rather than reported. */
  readonly estimated: boolean;
};

/**
 * Reported dollars with each currency's estimate, dollars first. Dollars are
 * always listed when nothing else is, so an unpriced range reads as $0.00.
 */
export function spentIn(spent: {
  readonly costUsd: number;
  readonly estimatedCosts?: readonly MoneyAmount[];
}): SpentIn[] {
  const estimates = spent.estimatedCosts ?? [];
  const dollars = estimates.find((each) => each.currency === "USD");
  const others = estimates
    .filter((each) => each.currency !== "USD")
    .map((each) => ({ ...each, estimated: true }));
  const showDollars = spent.costUsd > 0 || dollars || others.length === 0;
  return [
    ...(showDollars
      ? [
          {
            currency: "USD",
            amount: spent.costUsd + (dollars?.amount ?? 0),
            estimated: dollars !== undefined,
          },
        ]
      : []),
    ...others,
  ];
}

/**
 * Each currency's amount, marked where an estimate is counted in it. Stacked
 * puts each currency on a line of its own, for a headline figure.
 */
export function SpentAmounts({
  spent,
  stacked = false,
}: {
  spent: Parameters<typeof spentIn>[0];
  stacked?: boolean;
}) {
  return (
    <>
      {spentIn(spent).map((each, index) => (
        <span
          key={each.currency}
          className={stacked ? styles["spent--stacked"] : undefined}
        >
          {!stacked && index > 0 ? " · " : ""}
          {formatMoney(each.amount, each.currency)}
          {each.estimated && (
            <span className={styles["spent__estimated"]}> estimated</span>
          )}
        </span>
      ))}
    </>
  );
}
