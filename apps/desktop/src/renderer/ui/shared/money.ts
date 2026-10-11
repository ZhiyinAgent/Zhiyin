/**
 * Amounts of money as the window writes them: each in its own currency,
 * never converted into another.
 */

const symbols: Readonly<Record<string, string>> = { USD: "$", CNY: "¥" };

/** `$` or `¥`; any other currency by its code, before the amount. */
export function currencySymbol(currency: string): string {
  return symbols[currency] ?? `${currency} `;
}

/** Cents for anything worth a cent; below that, two significant places. */
export function formatMoney(value: number, currency = "USD"): string {
  const symbol = currencySymbol(currency);
  if (value === 0 || value >= 0.01) return `${symbol}${value.toFixed(2)}`;
  return `${symbol}${Number(value.toPrecision(2)).toString()}`;
}
