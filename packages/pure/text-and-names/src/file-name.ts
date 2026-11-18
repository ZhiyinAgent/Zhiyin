/**
 * The name a file saved from a title is offered under: the title, in any
 * script, reduced to what every file system accepts, in lower case, cut
 * between characters at 80, and ending in `.ending`. A title with no letter
 * or digit to keep is called `fallback`.
 */
export function fileNameFor(
  title: string,
  fallback: string,
  ending: string,
): string {
  const stem = Array.from(
    title
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+/, ""),
  )
    .slice(0, 80)
    .join("")
    .replace(/-+$/, "");
  return `${/[\p{L}\p{N}]/u.test(stem) ? stem : fallback}.${ending}`;
}
