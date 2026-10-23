/** Instructions are measured for people in words, never in bytes. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function wordCount(count: number): string {
  return `${count.toLocaleString("en")} ${count === 1 ? "word" : "words"}`;
}
