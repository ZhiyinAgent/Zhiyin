/**
 * Names made for files and programs, said in words. A skill is named like a
 * file ("test-driven-development") and a tool like a function
 * ("search_issues"); a person reads "Test driven development" and "Search
 * issues". Anything already written in words is left as it is.
 */
export function inWords(name: string): string {
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)) return name;
  const spaced = name.replace(/[-_]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
