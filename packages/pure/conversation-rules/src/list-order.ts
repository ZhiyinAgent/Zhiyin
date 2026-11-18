import type { ConversationSummary } from "@zhiyin/contract";

/**
 * The order conversations are listed in: the one changed last first; any tie
 * by id, so the order is the same at every launch.
 */
export function newestFirst(
  a: Pick<ConversationSummary, "id" | "updatedAt">,
  b: Pick<ConversationSummary, "id" | "updatedAt">,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
