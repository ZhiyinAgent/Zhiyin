/** How a count and a list are written in a sentence, the same everywhere. */

/** "1 file", "3 files", "1,200 entries": the count, then the word for it. */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

const lists = {
  and: new Intl.ListFormat("en-GB", { type: "conjunction" }),
  or: new Intl.ListFormat("en-GB", { type: "disjunction" }),
};

/** "a", "a and b", "a, b and c"; or "a, b or c". */
export function listed(
  items: readonly string[],
  joiner: "and" | "or" = "and",
): string {
  return lists[joiner].format(items);
}
