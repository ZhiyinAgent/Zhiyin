/**
 * How a build or a drawing asks for its parts moved apart, as an exploded
 * view: the parts taken out, those kept in place, and how far apart.
 */

export type ExplodeAsked = {
  readonly parts?: readonly string[];
  readonly stay?: readonly string[];
  readonly spread?: number;
};

const KEYS = ["parts", "stay", "spread"];
/** The most any part is moved beyond what it passes, as a share of its own size. */
const WIDEST = 4;

const names = (value: unknown) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 200 &&
  value.every((name) => typeof name === "string" && name.trim().length > 0);

export function explodeOf(
  value: unknown,
):
  | { readonly ok: true; readonly explode: ExplodeAsked }
  | { readonly ok: false; readonly reason: string } {
  const fail = (reason: string) => ({ ok: false, reason }) as const;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(
      "explode is an object: parts to take out, stay to keep in place, spread for how far apart; {} explodes all but the largest part.",
    );
  const given = value as Record<string, unknown>;
  const stray = Object.keys(given).find((key) => !KEYS.includes(key));
  if (stray) return fail(`explode takes parts, stay and spread, not ${stray}.`);
  if (given["parts"] !== undefined && !names(given["parts"]))
    return fail("explode.parts names 1 to 200 shown parts.");
  if (given["stay"] !== undefined && !names(given["stay"]))
    return fail("explode.stay names 1 to 200 shown parts.");
  const spread = given["spread"];
  if (
    spread !== undefined &&
    !(
      typeof spread === "number" &&
      Number.isFinite(spread) &&
      spread >= 0 &&
      spread <= WIDEST
    )
  )
    return fail(`explode.spread is a number from 0 to ${WIDEST}.`);
  return {
    ok: true,
    explode: {
      ...(given["parts"] ? { parts: given["parts"] as string[] } : {}),
      ...(given["stay"] ? { stay: given["stay"] as string[] } : {}),
      ...(spread !== undefined ? { spread: spread as number } : {}),
    },
  };
}
