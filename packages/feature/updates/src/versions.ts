/**
 * Release versions as Zhiyin tags them, `0.1.0` or `0.1.0-alpha.2`, ordered
 * as semantic versioning orders them: a prerelease comes before its release,
 * and its parts compare one by one, numbers as numbers.
 */

const shape =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/** Whether the text is a version in that form. */
export function isVersion(text: string): boolean {
  return shape.test(text);
}

/** Below zero when `a` comes first, above when `b` does, zero when equal. */
export function compareVersions(a: string, b: string): number {
  const left = shape.exec(a);
  const right = shape.exec(b);
  if (!left || !right) throw new Error(`Not a version: ${left ? b : a}`);
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  const before = left[4]?.split(".");
  const after = right[4]?.split(".");
  if (!before || !after) return before ? -1 : after ? 1 : 0;
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    const one = before[index];
    const other = after[index];
    if (one === undefined) return -1;
    if (other === undefined) return 1;
    const numbers = /^\d+$/.test(one) && /^\d+$/.test(other);
    if (numbers) {
      const difference = Number(one) - Number(other);
      if (difference !== 0) return Math.sign(difference);
    } else if (/^\d+$/.test(one)) return -1;
    else if (/^\d+$/.test(other)) return 1;
    else if (one !== other) return one < other ? -1 : 1;
  }
  return 0;
}
