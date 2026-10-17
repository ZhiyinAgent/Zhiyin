/**
 * Names made for files and programs, said in words. A skill is named like a
 * file ("test-driven-development") and a tool like a function
 * ("search_issues"); a person reads "Test driven development" and "Search
 * issues". Anything already written in words is left as it is.
 */
export function inWords(name: string): string {
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) return name;
  const words = name
    .split(/[-_]+/)
    .map((word) => spelt.get(word) ?? word)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Words a name written for a program holds that have a spelling of their own. */
const spelt = new Map([
  ["api", "API"],
  ["csv", "CSV"],
  ["github", "GitHub"],
  ["html", "HTML"],
  ["json", "JSON"],
  ["latex", "LaTeX"],
  ["mcp", "MCP"],
  ["pdf", "PDF"],
  ["sql", "SQL"],
  ["typst", "Typst"],
  ["url", "URL"],
]);
