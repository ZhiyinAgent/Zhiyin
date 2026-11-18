/**
 * A parts list in words: what the approval says a .csv or a drawing's parts
 * list holds, and the answer's lines for one written, as the harness counted
 * its rows, with what it could not tell.
 */

/** What a parts list holds, after its file's name or as a drawing's row: its parts, their materials and its balloons. */
export function partsListWords(
  parts: readonly string[] | undefined,
  materials: Readonly<Record<string, string>> | undefined,
  /** For a drawing's: the view its balloons go on, left out for the default. */
  sheet?: { readonly balloons?: string },
): string {
  const given = Object.entries(materials ?? {});
  return [
    `a parts list of ${parts?.length ? parts.join(", ") : "the parts shown"}, each different part once with how many`,
    given.length
      ? `, ${given.map(([part, material]) => `${part} in ${material}`).join(", ")}`
      : ", no materials given",
    !sheet
      ? ", in CSV"
      : sheet.balloons
        ? `, ballooned on the ${sheet.balloons} view, or another where it does not show`
        : ", ballooned on the iso view, or the first without one, or another where it does not show",
  ].join("");
}

/** A parts list written, as the answer gives it: its file, its size, then its rows and what it could not tell, a line each. */
export function writtenListText(
  relative: string,
  size: string,
  lines: readonly string[],
): string {
  const [head, ...rest] = lines;
  return [
    `Wrote ${relative} (${size}), ${head ?? "a parts list"}`,
    ...rest,
  ].join("\n");
}

/** What the harness says of each dimension it read beyond its text, a line each. */
export function dimensionSaid(
  dimensions: readonly {
    readonly view: string;
    readonly text: string;
    readonly said?: string;
  }[],
): string[] {
  return dimensions
    .filter((one) => one.said)
    .map((one) => `${one.text} on ${one.view}: ${one.said}.`);
}
