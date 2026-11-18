/**
 * The values a requirement's fields take, each rule answering the problem
 * with a value in words that say how to mend it, or nothing when it is
 * right. A studio defining kinds of its own builds their fields from these.
 */

/** A rule for one field: the problem with its value, or nothing. */
export type FieldRule = (value: unknown) => string | undefined;

/** The longest a requirement's words, or a part's name or pattern, may be. */
export const longest = 200;
/** The most names a list of parts holds. */
export const mostNames = 200;

/** How a pattern is written, as the reasons show it. */
export const pattern = "a pattern such as /Bolt_.*/";

export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const isName = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= longest;
export const isNames = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= mostNames &&
  value.every(isName);
/** Three numbers along x, y and z, not all 0. */
export const isDirection = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(isNumber) &&
  value.some((v) => v !== 0);

/** A range of sizes: a number, which the measure must equal, or [least, most]. */
export const isRange = (value: unknown): boolean =>
  (isNumber(value) && value >= 0) ||
  (Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => isNumber(v) && v >= 0) &&
    (value[0] as number) <= (value[1] as number));

/** A rule that passes when `holds` does, or says `words`. */
export const rule =
  (holds: (value: unknown) => boolean, words: string): FieldRule =>
  (value) =>
    holds(value) ? undefined : words;

/** A number above 0, or, with `zero`, 0 or above. */
export const amount = (words: string, zero = false): FieldRule =>
  rule((v) => isNumber(v) && (zero ? v >= 0 : v > 0), words);

export const direction = (words: string): FieldRule => rule(isDirection, words);

export const flag = (words: string): FieldRule =>
  rule((v) => typeof v === "boolean", words);

/** One shown part, by name or pattern. */
export const part: FieldRule = rule(
  isName,
  `part names one shown part, or a pattern between slashes, at most ${longest} characters; ${pattern} stands for a long name`,
);

/** Shown parts, by name or pattern. */
export const parts: FieldRule = rule(
  isNames,
  `parts names from 1 to ${mostNames} shown parts, or patterns between slashes, each at most ${longest} characters; ${pattern} stands for many`,
);

/** An angle in degrees from 0 to 90. */
export const angle = (field: string): FieldRule =>
  rule(
    (v) => isNumber(v) && v >= 0 && v <= 90,
    `${field} is an angle in degrees, from 0 to 90`,
  );

/** Three sizes along x, y and z, any of them null for no limit there. */
export const sizes = (field: string): FieldRule =>
  rule(
    (v) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((one) => one === null || (isNumber(one) && one > 0)) &&
      v.some((one) => one !== null),
    `${field} is three sizes in mm along x, y and z, null for no limit along one`,
  );

/** Three ranges along x, y and z, any of them null for no limit there. */
export const ranges = (field: string): FieldRule =>
  rule(
    (v) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((one) => one === null || isRange(one)) &&
      v.some((one) => one !== null),
    `${field} is three sizes in mm along x, y and z, each a number it must be, [least, most], or null for no limit along one`,
  );

/** A point [x, y, z] in mm, any of its numbers null where it may be anywhere. */
export const point = (words: string): FieldRule =>
  rule(
    (v) =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((one) => one === null || isNumber(one)) &&
      v.some((one) => one !== null),
    words,
  );
