import type { MemorySection } from "@zhiyin/contract";

/** Each section as the page names it. */
export const sectionNames: Record<MemorySection, string> = {
  about: "About you",
  how: "How to work",
  brief: "Brief",
  knowledge: "Knowledge",
};

const dayAndMonth = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

/** A date as the page shows it: the day and month. */
export function shortDate(at: string): string {
  return dayAndMonth.format(new Date(at));
}
